import os

from dotenv import load_dotenv

load_dotenv()

MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_SOURCE_CHARS = 12000
MOCK_USER_ID = "00000000-0000-0000-0000-000000000123"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://scrolled:scrolled@127.0.0.1:5432/scrolled")

YANDEX_API_KEY = os.getenv("YANDEX_API_KEY")
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID")
YANDEX_MODEL = os.getenv("YANDEX_MODEL", "yandexgpt-lite")
YANDEX_MODEL_VERSION = os.getenv("YANDEX_MODEL_VERSION", "latest")
YANDEX_ENDPOINT = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
YANDEX_RETRY_ATTEMPTS = 3
YANDEX_RETRY_DELAYS = (2, 5)
IMAGE_STYLE_SUFFIX = "in 2D semi-cartoon hand-drawn illustration style, vibrant colors, flat design, educational art"

S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "https://storage.yandexcloud.net")
S3_BUCKET = os.getenv("S3_BUCKET")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL")

ENFORCE_BOOK_LIMIT = os.getenv("ENFORCE_BOOK_LIMIT", "false").lower() == "true"
REVENUECAT_WEBHOOK_SECRET = os.getenv("REVENUECAT_WEBHOOK_SECRET")
