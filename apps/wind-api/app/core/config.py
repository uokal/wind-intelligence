from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import json
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    PROJECT_NAME: str = "Wind Analytics API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    BACKEND_CORS_ORIGINS: List[str] = []

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.BACKEND_CORS_ORIGINS:
            cors_env = os.getenv("BACKEND_CORS_ORIGINS", "")
            if cors_env:
                try:
                    self.BACKEND_CORS_ORIGINS = json.loads(cors_env)
                except json.JSONDecodeError:
                    self.BACKEND_CORS_ORIGINS = [o.strip() for o in cors_env.split(",") if o.strip()]


settings = Settings()