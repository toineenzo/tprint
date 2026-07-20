FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Captures the moment this image was actually built (i.e. when Portainer
# last pulled + rebuilt the stack) so the UI can show "last updated".
RUN date -u +"%Y-%m-%d %H:%M UTC" > /app/build_info.txt

ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
