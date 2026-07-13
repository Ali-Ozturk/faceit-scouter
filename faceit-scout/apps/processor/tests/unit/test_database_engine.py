from scout_processor.database.engine import sqlalchemy_database_url


def test_postgresql_url_uses_psycopg_driver():
    assert (
        sqlalchemy_database_url("postgresql://user:pass@postgres:5432/db")
        == "postgresql+psycopg://user:pass@postgres:5432/db"
    )


def test_explicit_driver_url_is_preserved():
    assert (
        sqlalchemy_database_url("postgresql+psycopg://user:pass@postgres:5432/db")
        == "postgresql+psycopg://user:pass@postgres:5432/db"
    )
