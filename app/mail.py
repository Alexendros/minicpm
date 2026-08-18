import email
import email.header
import imaplib
import json
import os
import re
import shutil
import smtplib
import socket
import ssl
import subprocess
import threading
import time
from email.message import EmailMessage
from html.parser import HTMLParser

IMAP_HOST = os.environ.get("PROTON_IMAP_HOST", "127.0.0.1")
IMAP_PORT = int(os.environ.get("PROTON_IMAP_PORT", "1143"))
SMTP_HOST = os.environ.get("PROTON_SMTP_HOST", "127.0.0.1")
SMTP_PORT = int(os.environ.get("PROTON_SMTP_PORT", "1025"))
CREDS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mail_creds.json")
SECRET_SERVICE = "minicpm"
SECRET_LABEL = "MiniCPM Proton Bridge"

_fetch_lock = threading.Lock()
_last_fetch_ts = 0.0
FETCH_MIN_INTERVAL = 0.2


def _throttle_fetch():
    global _last_fetch_ts
    with _fetch_lock:
        wait = FETCH_MIN_INTERVAL - (time.monotonic() - _last_fetch_ts)
        if wait > 0:
            time.sleep(wait)
        _last_fetch_ts = time.monotonic()


def tls_ctx():
    if IMAP_HOST not in ("127.0.0.1", "localhost", "::1") or SMTP_HOST not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("Bridge remoto exige verificación TLS")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _creds_from_env():
    return os.environ.get("PROTON_USER"), os.environ.get("PROTON_PASS")


def _creds_from_keyring():
    if not shutil.which("secret-tool"):
        return None, None
    r = subprocess.run(
        ["secret-tool", "search", "service", SECRET_SERVICE],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None, None
    user = None
    for line in r.stdout.splitlines():
        m = re.match(r"\s*attribute\.user = (.*)", line)
        if m:
            user = m.group(1)
            break
    if not user:
        return None, None
    r2 = subprocess.run(
        ["secret-tool", "lookup", "service", SECRET_SERVICE, "user", user],
        capture_output=True, text=True,
    )
    if r2.returncode == 0 and r2.stdout.strip():
        return user, r2.stdout.rstrip("\n")
    return None, None


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
    user, pw = _creds_from_keyring()
    if user and pw:
        return user, pw
    return _creds_from_file()


def save_creds(user, pw):
    if not shutil.which("secret-tool"):
        raise RuntimeError(
            "secret-tool no está disponible: instala libsecret-tools para guardar credenciales sin escribirlas en disco"
        )
    subprocess.run(
        ["secret-tool", "store", "--label", SECRET_LABEL, "service", SECRET_SERVICE, "user", user],
        input=pw + "\n", text=True, capture_output=True, check=True,
    )


def clear_creds():
    if shutil.which("secret-tool"):
        subprocess.run(
            ["secret-tool", "clear", "--all", "service", SECRET_SERVICE],
            capture_output=True, text=True,
        )
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
        typ, data = imap.uid("FETCH", str(int(uid)).encode(), "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])")
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


def folders():
    with _connect() as imap:
        typ, data = imap.list()
        if typ != "OK" or not data:
            return {"folders": []}
        out = []
        for item in data:
            line = item.decode("utf-8", "replace") if isinstance(item, bytes) else item
            m = re.search(r'"([^"]*)"\s*$', line)
            if m:
                out.append(m.group(1))
        return {"folders": out}


def _select(imap, folder="INBOX", readonly=True):
    imap.select(folder, readonly=readonly)


def unread(limit=50, folder="INBOX"):
    with _connect() as imap:
        _select(imap, folder)
        typ, data = imap.uid("SEARCH", None, "UNSEEN")
        uids = data[0].split() if data and data[0] else []
        return {"count": len(uids), "messages": _summaries(imap, uids, limit)}


def search(from_=None, subject=None, text=None, since=None, unread_only=False, limit=50, folder="INBOX"):
    with _connect() as imap:
        _select(imap, folder)
        criteria = []
        if unread_only:
            criteria.append("UNSEEN")
        if since:
            criteria += ["SINCE", since]
        criteria = criteria or ["ALL"]
        criteria = [c.encode("utf-8") for c in criteria]
        typ, data = imap.uid("SEARCH", *criteria)
        uids = data[0].split() if data and data[0] else []
        msgs = _summaries(imap, uids, 200)
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
                    m["body"] = fetch(m["uid"], folder=folder)["body"]
                except Exception:
                    m["body"] = ""
            msgs = [m for m in msgs if needle in (m["body"] or "").lower()]
        return {"count": len(msgs), "messages": msgs[:limit]}


class _TextExtractor(HTMLParser):
    BLOCK_TAGS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "blockquote"}

    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(html):
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:
        return ""
    return re.sub(r"\n{3,}", "\n\n", "".join(p.parts)).strip()


def extract_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition")):
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                return html_to_text(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace"))
    payload = msg.get_payload(decode=True)
    if not payload:
        return ""
    text = payload.decode(msg.get_content_charset() or "utf-8", "replace")
    if msg.get_content_type() == "text/html":
        return html_to_text(text)
    return text


def _attachments(msg):
    out = []
    if not msg.is_multipart():
        return out
    for i, part in enumerate(msg.walk()):
        if part.get_content_disposition() != "attachment" and not part.get_filename():
            continue
        payload = part.get_payload(decode=True)
        out.append({
            "part": i,
            "filename": decode_header_value(part.get_filename() or f"adjunto-{i}"),
            "ctype": part.get_content_type(),
            "size": len(payload) if payload else 0,
        })
    return out


def fetch(uid, folder="INBOX"):
    _throttle_fetch()
    with _connect() as imap:
        _select(imap, folder)
        typ, data = imap.uid("FETCH", str(uid).encode(), "(RFC822)")
        if not data or not isinstance(data[0], tuple):
            raise KeyError(f"UID {uid} no encontrado")
        msg = email.message_from_bytes(data[0][1])
        return {
            "uid": int(uid),
            "folder": folder,
            "date": msg.get("Date", ""),
            "from": decode_header_value(msg.get("From", "")),
            "to": decode_header_value(msg.get("To", "")),
            "subject": decode_header_value(msg.get("Subject", "")),
            "message_id": msg.get("Message-ID", ""),
            "references": msg.get("References", ""),
            "in_reply_to": msg.get("In-Reply-To", ""),
            "attachments": _attachments(msg),
            "body": extract_body(msg),
        }


def fetch_attachment(uid, part, folder="INBOX"):
    _throttle_fetch()
    with _connect() as imap:
        _select(imap, folder)
        typ, data = imap.uid("FETCH", str(uid).encode(), "(RFC822)")
        if not data or not isinstance(data[0], tuple):
            raise KeyError(f"UID {uid} no encontrado")
        msg = email.message_from_bytes(data[0][1])
        if not msg.is_multipart():
            raise KeyError(f"UID {uid} sin adjuntos")
        for i, p in enumerate(msg.walk()):
            if i == part:
                payload = p.get_payload(decode=True)
                if payload is None:
                    raise ValueError("parte sin contenido decodificable")
                return {
                    "filename": decode_header_value(p.get_filename() or f"adjunto-{part}"),
                    "ctype": p.get_content_type(),
                    "data": payload,
                }
        raise KeyError(f"parte {part} no encontrada")


def mark(uid, read=True, folder="INBOX"):
    with _connect() as imap:
        _select(imap, folder, readonly=False)
        flag = "+FLAGS" if read else "-FLAGS"
        imap.uid("STORE", str(uid).encode(), flag, r"(\Seen)")
        return {"uid": int(uid), "folder": folder, "read": read}


def send(to, subject, body, in_reply_to=None, references=None):
    user, pw = get_creds()
    if not user or not pw:
        raise RuntimeError("Correo no configurado: faltan credenciales")
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        refs = [r for r in (references or "").split() if r]
        if in_reply_to not in refs:
            refs.append(in_reply_to)
        msg["References"] = " ".join(refs)
    msg.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.starttls(context=tls_ctx())
        s.login(user, pw)
        s.send_message(msg)
    return {"to": to, "subject": subject}