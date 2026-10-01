# Security

PaperFlow is a local single-user app. It binds to `127.0.0.1` and has no login or multi-user authorization. Do not place it behind a public proxy or share its data folder across users.

Credentials are stored in plaintext in the user's PaperFlow data folder outside the repository. POSIX file modes are restricted; Windows relies on the containing user directory's permissions. Saved keys are never returned through the API or stored in browser storage. Local processes and users with access to that folder can read them. Full disk encryption and appropriate operating-system account permissions remain the user's responsibility.

Uploaded notes are sent to OpenAI only when processing is requested, and to Notion only when publishing is requested. The app uses fixed provider URLs, limits request bodies, validates PDFs, escapes displayed source text, checks hostnames/origins, and does not enable cross-origin API access. Provider responses and unexpected error details are not included in public errors or logs.

To report a suspected vulnerability, use the repository's **Security → Report a vulnerability** private reporting feature if it is enabled. Otherwise contact the maintainer privately through their GitHub profile before disclosing exploit details publicly. Do not post credentials, private PDFs, or identifying student data in issues. If a key was exposed, revoke it through its provider; removing the local copy does not revoke it.

The maintained version is the latest code on `main`; tagged releases will receive explicit support ranges when releases are introduced.
