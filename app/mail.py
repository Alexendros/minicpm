import email
import email.header
import imaplib
import json
import os
import smtplib
import socket
import ssl
from email.message import EmailMessage

IMAP_HOST = os.environ.get("PROTON_IMAP_HOST", "127.0.0.1")
IMAP_PORT = int(os.environ.get("PROTON_IMAP_PORT", "1143"))
SMTP_HOST = os.environ.get("PROTON_SMTP_HOST", "127.0.0.1")
SMTP_PORT = int(os.environ.get("PROTON_SMTP_PORT", "1025"))
CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mail_creds.json")


def tls_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _creds_from_env():
    return os.environ.get("PROTON_USER"), os.environ.get("PROTON_PASS")


def _creds_from_file():
    try:
        with open(CREDS_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
        return d.get("user"), d.get("pass")
    except (OSError, ValueError):
        return None, None


def get_creds():
    user, pw = _creds_from_env()
    if user and pw:
        return user, pw
    return _creds_from_file()


def save_creds(user, pw):
    os.makedirs(os.path.dirname(CREDS_FILE), exist_ok=True)
    with open(CREDS_FILE, "w", encoding="utf-8") as f:
        json.dump({"user": user, "pass": pw}, f)
    os.chmod(CREDS_FILE, 0o600)


def clear_creds():
    try:
        os.remove(CREDS_FILE)
    except OSError:
        pass


def bridge_up():
    for host, port in ((IMAP_HOST, IMAP_PORT), (SMTP_HOST, SMTP_PORT)):
        try:
            with socket.create_connection((host, port), timeout=2):
                pass
        except OSError:
            return False
    return True


def status():
    user, pw = get_creds()
    return {"bridge_up": bridge_up(), "configured": bool(user and pw), "user": user}


def _connect():
    imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
    imap.starttls(ssl_context=tls_ctx())
    user, pw = get_creds()
    if not user or not pw:
        raise RuntimeError("Correo no configurado: faltan credenciales")
    imap.login(user, pw)
    return imap


def decode_header_value(v):
    if not v:
        return ""
    parts = email.header.decode_header(v)
    out = []
    for txt, enc in parts:
        out.append(txt.decode(enc or "utf-8", "replace") if isinstance(txt, bytes) else txt)
    return "".join(out)


def _summaries(imap, uids, limit):
    out = []
    for uid in uids[-limit:][::-1]:
        typ, data = imap.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])")
        if not data or not isinstance(data[0], tuple):
            continue
        msg = email.message_from_bytes(data[0][1])
        out.append({
            "uid": int(uid),
            "date": msg.get("Date", ""),
            "from": decode_header_value(msg.get("From", "")),
            "subject": decode_header_value(msg.get("Subject", "")),
            "message_id": msg.get("Message-ID", ""),
        })
    return out


def _select_inbox(imap, readonly=True):
    imap.select("INBOX", readonly=readonly)


def unread(limit=50):
    with _connect() as imap:
        _select_inbox(imap)
        typ, data = imap.search(None, "UNSEEN")
        uids = data[0].split() if data and data[0] else []
        return {"count": len(uids), "messages": _summaries(imap, uids, limit)}


def _has_non_ascii(s):
    return any(ord(c) > 127 for c in s)


def _quoted(s):
    return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')


def search(from_=None, subject=None, text=None, since=None, unread_only=False, limit=50):
    local_filter = any(
        v and _has_non_ascii(v) for v in (from_, subject, text)
    )
    with _connect() as imap:
        _select_inbox(imap)
        if local_filter:
            criteria = []
            if unread_only:
                criteria.append("UNSEEN")
            if since:
                criteria += ["SINCE", since]
            criteria = criteria or ["ALL"]
            criteria = [c.encode("utf-8") for c in criteria]
            typ, data = imap.search("UTF-8", *criteria)
            uids = data[0].split() if data and data[0] else []
            msgs = _summaries(imap, uids, 500)
            if from_:
                needle = from_.lower()
                msgs = [m for m in msgs if needle in (m["from"] or "").lower()]
            if subject:
                needle = subject.lower()
                msgs = [m for m in msgs if needle in (m["subject"] or "").lower()]
            if text:
                needle = text.lower()
                for m in msgs:
                    try:
                        m["body"] = fetch(m["uid"])["body"]
                    except Exception:
                        m["body"] = ""
                msgs = [m for m in msgs if needle in (m["body"] or "").lower()]
            return {"count": len(msgs), "messages": msgs[:limit]}
        criteria = []
        if unread_only:
            criteria.append("UNSEEN")
        if from_:
            criteria += ["FROM", _quoted(from_)]
        if subject:
            criteria += ["SUBJECT", _quoted(subject)]
        if text:
            criteria += ["TEXT", _quoted(text)]
        if since:
            criteria += ["SINCE", since]
        if not criteria:
            criteria = ["ALL"]
        criteria = [c.encode("utf-8") if isinstance(c, str) else c for c in criteria]
        typ, data = imap.search("UTF-8", *criteria)
        uids = data[0].split() if data and data[0] else []
        return {"count": len(uids), "messages": _summaries(imap, uids, limit)}


def extract_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition")):
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
    payload = msg.get_payload(decode=True)
    return payload.decode(msg.get_content_charset() or "utf-8", "replace") if payload else ""


def fetch(uid):
    with _connect() as imap:
        _select_inbox(imap)
        typ, data = imap.fetch(str(uid).encode(), "(RFC822)")
        if not data or not isinstance(data[0], tuple):
            raise KeyError(f"UID {uid} no encontrado")
        msg = email.message_from_bytes(data[0][1])
        return {
            "uid": int(uid),
            "date": msg.get("Date", ""),
            "from": decode_header_value(msg.get("From", "")),
            "to": decode_header_value(msg.get("To", "")),
            "subject": decode_header_value(msg.get("Subject", "")),
            "message_id": msg.get("Message-ID", ""),
            "body": extract_body(msg),
        }


def mark(uid, read=True):
    with _connect() as imap:
        _select_inbox(imap, readonly=False)
        flag = "+FLAGS" if read else "-FLAGS"
        imap.store(str(uid).encode(), flag, "(\\Seen)")
        return {"uid": int(uid), "read": read}


def send(to, subject, body):
    user, pw = get_creds()
    if not user or not pw:
        raise RuntimeError("Correo no configurado: faltan credenciales")
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls(context=tls_ctx())
        s.login(user, pw)
        s.send_message(msg)
    return {"to": to, "subject": subject}