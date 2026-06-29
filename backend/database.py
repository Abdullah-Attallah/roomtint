"""
PostgreSQL database connection using psycopg2.
Set DATABASE_URL in your .env file.
Example: postgresql://user:password@localhost:5432/roomtint
"""
import os
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/roomtint")


@contextmanager
def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create tables if they don't exist."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS saved_results (
                    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    color_hex   TEXT NOT NULL,
                    intensity   INTEGER NOT NULL DEFAULT 40,
                    share_id    TEXT UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
                    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS saved_colors (
                    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    color_hex   TEXT NOT NULL,
                    color_name  TEXT,
                    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
                );
            """)
    print("✅ Database tables ready")
