from fastapi import FastAPI

app = FastAPI(title="Generated App", description="This placeholder will be replaced with app-specific content.")


@app.get("/")
def read_root():
    return {"app": "Generated App", "description": "This placeholder will be replaced with app-specific content."}
