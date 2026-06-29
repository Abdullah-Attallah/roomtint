"""
Saved Results API — disabled. 
Tables still exist but routes return empty/no-op responses.
To fully remove: delete this file and remove from main.py includes.
"""
from fastapi import APIRouter

router = APIRouter()

# All result/color endpoints removed from active UI.
# Database tables still exist — clear them with:
#   psql -U postgres -d roomtint -c "TRUNCATE saved_results, saved_colors;"
# Or drop entirely:
#   psql -U postgres -d roomtint -c "DROP TABLE IF EXISTS saved_results, saved_colors;"
