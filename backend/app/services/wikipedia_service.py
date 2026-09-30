from __future__ import annotations

from typing import Any

import httpx

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"


def _article_media(payload: dict[str, Any]) -> dict[str, str] | None:
    pages = (payload.get("query") or {}).get("pages") or {}
    for page in pages.values():
        if page.get("missing") is not None:
            continue
        image_url = ((page.get("thumbnail") or {}).get("source") or "").strip()
        summary = " ".join(str(page.get("extract") or "").split())
        if image_url and summary:
            return {"image_url": image_url, "wiki_summary": summary}
    return None


async def search_wikipedia_images(query: str, *, limit: int = 12) -> list[dict[str, str]]:
    """Return Wikimedia candidates from the article for AI selection."""
    normalized_query = query.strip()
    if not normalized_query:
        return []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 ScrollEd/1.0",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    base = {"action": "query", "format": "json", "formatversion": "2", "titles": normalized_query}
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            article = await client.get(WIKIPEDIA_API_URL, params={**base, "prop": "images", "imlimit": 50}, headers=headers)
            article.raise_for_status()
            raw_pages = (article.json().get("query") or {}).get("pages") or []
            pages = raw_pages if isinstance(raw_pages, list) else list(raw_pages.values())
            if not pages or pages[0].get("missing"):
                search_response = await client.get(
                    WIKIPEDIA_API_URL,
                    params={"action": "query", "list": "search", "srsearch": normalized_query, "srlimit": 1, "format": "json"},
                    headers=headers,
                )
                search_response.raise_for_status()
                matches = ((search_response.json().get("query") or {}).get("search") or [])
                if not matches or not matches[0].get("pageid"):
                    return []
                article = await client.get(
                    WIKIPEDIA_API_URL,
                    params={**base, "pageids": matches[0]["pageid"], "titles": None, "prop": "images", "imlimit": 50},
                    headers=headers,
                )
                article.raise_for_status()
                raw_pages = (article.json().get("query") or {}).get("pages") or []
            pages = raw_pages if isinstance(raw_pages, list) else list(raw_pages.values())
            if not pages or pages[0].get("missing"):
                return []
            image_titles = [item["title"] for item in pages[0].get("images", []) if item.get("title")]
            image_titles = [title for title in image_titles if not title.lower().endswith(".svg") and not any(word in title.lower() for word in ("icon", "logo", "commons", "ambox", "edit-clear", "question", "flag"))]
            if not image_titles:
                return []
            details = await client.get(
                WIKIPEDIA_API_URL,
                params={"action": "query", "format": "json", "formatversion": "2", "titles": "|".join(image_titles[:50]), "prop": "imageinfo", "iiprop": "url|extmetadata"},
                headers=headers,
            )
            details.raise_for_status()
            result = []
            for page in (details.json().get("query") or {}).get("pages", []):
                info = (page.get("imageinfo") or [{}])[0]
                url = str(info.get("url") or "").strip()
                metadata = info.get("extmetadata") or {}
                description = str((metadata.get("ImageDescription") or {}).get("value") or metadata.get("ObjectName", {}).get("value") or page.get("title") or "").strip()
                # URL is enough to keep a candidate; Wikimedia often has no description.
                description = " ".join(description.replace("<p>", " ").replace("</p>", " ").split()) or page.get("title", "Wikipedia image")
                if url:
                    result.append({"image_url": url, "description": description[:500]})
                if len(result) >= limit:
                    break
            return result
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return []


async def search_wikipedia_image(query: str) -> dict[str, str] | None:
    """Return an article thumbnail and introductory text for an exact Wikipedia title."""
    normalized_query = query.strip()
    if not normalized_query:
        return None

    params = {
        "action": "query",
        "prop": "pageimages|extracts",
        "exintro": "1",
        "explaintext": "1",
        "pithumbsize": "1000",
        "format": "json",
        "titles": normalized_query,
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 ScrollEd/1.0",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(WIKIPEDIA_API_URL, params=params, headers=headers)
            response.raise_for_status()
            media = _article_media(response.json())
            if media:
                return media

            # GPT can produce a close but not exact title. Resolve it through the native
            # search endpoint, then request the first matching article with pageimages.
            search_response = await client.get(
                WIKIPEDIA_API_URL,
                params={"action": "query", "list": "search", "srsearch": normalized_query, "srlimit": 1, "format": "json"},
                headers=headers,
            )
            search_response.raise_for_status()
            matches = ((search_response.json().get("query") or {}).get("search") or [])
            if not matches:
                return None
            page_id = matches[0].get("pageid")
            if not page_id:
                return None
            article_response = await client.get(
                WIKIPEDIA_API_URL,
                params={**params, "titles": None, "pageids": page_id},
                headers=headers,
            )
            article_response.raise_for_status()
            return _article_media(article_response.json())
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None
