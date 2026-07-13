FROM python:3.12-bookworm
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY . .
CMD ["python", "-m", "scout_processor.main"]
