import os

# Set before climasure.api is imported, so the module-level app never touches a real database file.
os.environ.setdefault("CLIMASURE_DB_PATH", ":memory:")
os.environ.setdefault("CLIMASURE_WEATHER_PROVIDER", "synthetic")
os.environ.setdefault("CLIMASURE_ADMIN_API_KEY", "test-admin")
