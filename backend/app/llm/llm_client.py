"""Provider-agnostic LLM interface. The provider is chosen with the LLM_PROVIDER env var."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str


class LLMClient(Protocol):
    async def complete(self, messages: list[Message]) -> str: ...

    def stream(self, messages: list[Message]) -> AsyncIterator[str]: ...


class NullClient:
    """Default when LLM_PROVIDER=none. It never calls the network."""

    async def complete(self, messages: list[Message]) -> str:
        return ""

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        return
        yield


def get_llm_client(settings: Settings | None = None) -> LLMClient:
    settings = settings or get_settings()
    provider = settings.llm_provider.lower()
    if provider == "none":
        return NullClient()
    # Register real providers here, e.g. "anthropic": AnthropicClient(settings.llm_api_key).
    raise ValueError(f"Unknown LLM_PROVIDER: {settings.llm_provider!r}")
