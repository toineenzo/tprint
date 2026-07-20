from pathlib import Path

from fastapi.templating import Jinja2Templates

from app import config

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["build_date"] = config.get_build_date()
