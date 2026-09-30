from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix="/api", tags=["media"])
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 ScrollEd/1.0",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@router.get("/wiki-image")
async def wiki_image(url: str = Query(min_length=1, max_length=2000)) -> Response:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"upload.wikimedia.org", "commons.wikimedia.org"}:
        raise HTTPException(status_code=400, detail="Only Wikimedia image URLs are supported")
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            response = await client.get(url, headers=BROWSER_HEADERS)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Wikimedia image is unavailable") from exc
    content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=502, detail="Wikimedia did not return an image")
    return Response(content=response.content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
