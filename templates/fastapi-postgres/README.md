# Generated App

Scaffolded by [What To Do?](https://github.com/jabluetooth/what-to-do).

## Setup

1. Create a virtual environment and install dependencies:
   ```
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Postgres connection string.
3. Run the dev server:
   ```
   uvicorn main:app --reload
   ```
4. Open http://localhost:8000/docs for interactive API docs.

## Note on validation

This boilerplate was checked for valid Python syntax before delivery, not run end-to-end
(unlike the Next.js template, which gets a real install + build check). Review `main.py` and
`models.py` before relying on it.
