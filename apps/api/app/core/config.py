"""HOMIE API — Core configuration."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "homie"
    postgres_user: str = "homie"
    postgres_password: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # S3 / MinIO
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_images: str = "homie-images"
    s3_bucket_scenes: str = "homie-scenes"
    s3_region: str = "us-east-1"

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_secret_key: str = "dev-secret"
    api_cors_origins: str = "http://localhost:8081,http://localhost:5173,exp://localhost:8081"

    # JWT (kept for future use)
    jwt_secret_key: str = "dev-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # Reconstruction APIs
    world_labs_api_key: str = ""
    fal_key: str = ""
    elevenlabs_api_key: str = ""

    @property
    def database_url(self) -> str:
        auth = self.postgres_user if not self.postgres_password else f"{self.postgres_user}:{self.postgres_password}"
        return f"postgresql+asyncpg://{auth}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    @property
    def database_url_sync(self) -> str:
        auth = self.postgres_user if not self.postgres_password else f"{self.postgres_user}:{self.postgres_password}"
        return f"postgresql://{auth}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
