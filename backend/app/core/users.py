from uuid import UUID

import asyncpg


async def ensure_user(connection: asyncpg.Connection, user_id: UUID) -> None:
    await connection.execute(
        """insert into app_user(id, email, password_hash)
           values($1, $2, 'demo-account-no-password-yet')
           on conflict (id) do nothing""",
        user_id,
        f"learner-{user_id}@scrolled.local",
    )
