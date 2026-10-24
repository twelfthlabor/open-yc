from aiwarden.secrets import find_secrets, is_placeholder, looks_like_secret_key, redact

# Synthetic tokens, built at runtime so the repo never contains a real-looking literal.
GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
AWS = "AKIA" + "IOSFODNN7EXAMPLE"
OPENAI = "sk-proj-" + "x" * 40
ANTH = "sk-ant-api03-" + "Z" * 60
SLACK = "xoxb-" + "1234567890-1234567890-" + "abcdefghijklmnopqrstuvwx"


def test_detects_known_token_formats():
    kinds = {f.kind for f in find_secrets(f"{GH} {AWS} {OPENAI} {ANTH} {SLACK}")}
    assert {"github_token", "aws_access_key", "openai_key", "anthropic_key", "slack_token"} <= kinds


def test_anthropic_key_not_double_counted_as_openai():
    kinds = [f.kind for f in find_secrets(ANTH)]
    assert kinds == ["anthropic_key"]


def test_no_false_positive_on_plain_text():
    assert find_secrets("npx -y @modelcontextprotocol/server-filesystem /tmp") == []
    assert find_secrets("${env:GITHUB_TOKEN}") == []


def test_redact_never_returns_full_value():
    r = redact(GH)
    assert GH not in r
    assert r.startswith("ghp_")
    assert "…" in r


def test_redact_short_value_fully_masked():
    assert redact("abc") == "***"


def test_secret_key_names():
    assert looks_like_secret_key("GITHUB_PERSONAL_ACCESS_TOKEN")
    assert looks_like_secret_key("api_key")
    assert looks_like_secret_key("Authorization")
    assert looks_like_secret_key("DB_PASSWORD")
    assert not looks_like_secret_key("LOG_LEVEL")
    assert not looks_like_secret_key("MAX_TOKENS")


def test_placeholder_values_are_not_secrets():
    for v in ["${GITHUB_TOKEN}", "${env:X}", "<your-token>", "YOUR_API_KEY", "", "changeme", "${input:token}"]:
        assert is_placeholder(v), v
    assert not is_placeholder("q8Jf02kLmZp93nVb")


def test_private_key_block():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"
    assert any(f.kind == "private_key" for f in find_secrets(pem))
