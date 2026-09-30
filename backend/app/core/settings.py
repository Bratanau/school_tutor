from dataclasses import dataclass
import os

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "ScrollEd API")
    app_version: str = os.getenv("APP_VERSION", "1.0.0")
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql://scrolled:scrolled@127.0.0.1:5432/scrolled"
    )
    demo_user_id: str = os.getenv(
        "DEMO_USER_ID", "00000000-0000-0000-0000-000000000123"
    )
    yandex_api_key: str | None = os.getenv("YANDEX_API_KEY")
    yandex_folder_id: str | None = os.getenv("YANDEX_FOLDER_ID")
    yandex_model: str = os.getenv("YANDEX_MODEL", "yandexgpt-lite")
    yandex_model_version: str = os.getenv("YANDEX_MODEL_VERSION", "latest")
    yandex_endpoint: str = os.getenv(
        "YANDEX_ENDPOINT",
        "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
    )
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "*").split(",")
        if origin.strip()
    )


settings = Settings()
