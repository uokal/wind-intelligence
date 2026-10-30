import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", []),
        ("  ", []),
        ("https://wind-web-six.vercel.app", ["https://wind-web-six.vercel.app"]),
        (
            "https://wind-web-six.vercel.app, http://localhost:5173",
            ["https://wind-web-six.vercel.app", "http://localhost:5173"],
        ),
        ('["https://wind-web-six.vercel.app"]', ["https://wind-web-six.vercel.app"]),
    ],
)
def test_cors_environment_formats_do_not_crash_startup(monkeypatch, value, expected):
    monkeypatch.setenv("BACKEND_CORS_ORIGINS", value)
    assert Settings(_env_file=None).BACKEND_CORS_ORIGINS == expected
