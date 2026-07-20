from pathlib import Path

from fastapi.templating import Jinja2Templates

from app import config, i18n

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.globals["build_date"] = config.get_build_date()
templates.env.globals["all_languages"] = i18n.LANGUAGES
templates.env.globals["native_names"] = i18n.NATIVE_NAMES
