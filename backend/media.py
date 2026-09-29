from __future__ import annotations

import asyncio
import base64
import json
import re
import uuid

import boto3
import httpx

from config import (
    IMAGE_STYLE_SUFFIX,
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT_URL,
    S3_PUBLIC_BASE_URL,
    S3_SECRET_ACCESS_KEY,
    YANDEX_API_KEY,
    YANDEX_ENDPOINT,
    YANDEX_FOLDER_ID,
    YANDEX_MODEL,
)


def strip_code_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    if raw.startswith("[") and raw.endswith("]"):
        return raw
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        return raw[start:end + 1]
    return raw


async def upload_to_storage(file_bytes: bytes, extension: str) -> str:
    if not S3_BUCKET or not S3_ACCESS_KEY_ID or not S3_SECRET_ACCESS_KEY:
        raise RuntimeError("S3 storage is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")

    key = f"stories/{uuid.uuid4()}.{extension}"

    def put_object() -> None:
        client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            region_name="ru-central1",
            aws_access_key_id=S3_ACCESS_KEY_ID,
            aws_secret_access_key=S3_SECRET_ACCESS_KEY,
        )
        client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=file_bytes,
            ContentType="audio/mpeg" if extension == "mp3" else "image/jpeg",
            CacheControl="public, max-age=31536000",
        )

    await asyncio.to_thread(put_object)
    base_url = S3_PUBLIC_BASE_URL or f"{S3_ENDPOINT_URL}/{S3_BUCKET}"
    return f"{base_url.rstrip('/')}/{key}"


class YandexProvider:
    def __init__(self) -> None:
        self.api_key = YANDEX_API_KEY
        self.folder_id = YANDEX_FOLDER_ID
        self.headers = {"Authorization": f"Api-Key {self.api_key}"}
        self.gpt_endpoint = YANDEX_ENDPOINT
        self.art_endpoint = "https://llm.api.cloud.yandex.net/foundationModels/v1/imageGenerationAsync"
        self.operations_endpoint = "https://operation.api.cloud.yandex.net/operations"
        self.tts_endpoint = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize"

    def _require_credentials(self) -> None:
        if not self.api_key or not self.folder_id:
            raise RuntimeError("YANDEX_API_KEY or YANDEX_FOLDER_ID is not configured")

    async def generate_slides(self, source_text: str) -> list[dict]:
        self._require_credentials()
        system_prompt = (
            "Ты — ИИ-креатор образовательной ленты коротких видео. "
            "Раздели исходный текст на массив из 3-5 последовательных слайдов-фактов. "
            "Ответь СТРОГО массивом JSON-объектов [{...}], без markdown и комментариев. "
            "Для каждого слайда обязательно верни поля 'text', 'title' и 'imagePrompt'. "
            "Каждый imagePrompt должен быть подробным описанием уникальной иллюстрации "
            "на АНГЛИЙСКОМ языке и заканчиваться точным суффиксом: "
            f"'{IMAGE_STYLE_SUFFIX}'."
        )
        payload = {
            "modelUri": f"gpt://{self.folder_id}/{YANDEX_MODEL}/latest",
            "completionOptions": {"stream": False, "temperature": 0.4, "maxTokens": 2000},
            "messages": [
                {"role": "system", "text": system_prompt},
                {"role": "user", "text": f"Текст учебника:\n{source_text}"},
            ],
        }
        async with httpx.AsyncClient(timeout=40.0) as client:
            response = await client.post(self.gpt_endpoint, headers=self.headers, json=payload)
            response.raise_for_status()
            raw = response.json()["result"]["alternatives"][0]["message"]["text"]
            parsed = json.loads(strip_code_fence(raw))
            if not isinstance(parsed, list):
                raise ValueError("YandexGPT returned a non-array slide response")
            return parsed[:5]

    async def generate_image(self, prompt: str) -> str:
        self._require_credentials()
        payload = {
            "modelUri": f"art://{self.folder_id}/yandex-art/latest",
            "generationOptions": {"aspectRatio": {"widthRatio": 9, "heightRatio": 16}},
            "messages": [{"text": prompt, "weight": 1}],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(self.art_endpoint, headers=self.headers, json=payload)
            if response.status_code == 403:
                raise RuntimeError(f"YandexART access denied. Grant ai.imageGeneration.user on the folder: {response.text[:500]}")
            response.raise_for_status()
            operation_id = response.json().get("id")
            if not operation_id:
                raise RuntimeError(f"YandexART did not return operation id: {response.text[:500]}")
            for _ in range(90):
                await asyncio.sleep(2)
                operation = await client.get(f"{self.operations_endpoint}/{operation_id}", headers=self.headers)
                operation.raise_for_status()
                data = operation.json()
                if data.get("error"):
                    raise RuntimeError(f"YandexART operation failed: {data['error']}")
                if data.get("done"):
                    encoded = (data.get("response") or {}).get("image")
                    if not encoded:
                        raise RuntimeError(f"YandexART returned no image: {data}")
                    return await upload_to_storage(base64.b64decode(encoded), "jpeg")
        raise TimeoutError("YandexART operation timed out after 180 seconds")

    async def generate_audio(self, text: str) -> str:
        self._require_credentials()
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.tts_endpoint,
                headers=self.headers,
                data={"text": text, "voice": "filipp", "folderId": self.folder_id, "format": "mp3"},
            )
            response.raise_for_status()
            return await upload_to_storage(response.content, "mp3")
