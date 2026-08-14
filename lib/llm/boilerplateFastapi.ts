import { MODEL_QUALITY } from "@/lib/groq";
import { generateCodeFile } from "@/lib/llm/generateCode";
import { baseContext, pickResourceName } from "@/lib/llm/boilerplateShared";
import type { PrdSection } from "@/lib/types";

export interface FastapiFillIn {
  mainResourceName: string;
  modelsFileContent: string;
  mainFileContent: string;
}

async function generateModelsFile(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
}): Promise<string> {
  const example = `from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func

from database import Base


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)


class Trail(Base):
    __tablename__ = "trails"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    rating = Column(Integer, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())`;

  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 700,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nWrite models.py for a SQLAlchemy model named to match the resource "${input.mainResourceName}" (class name is the singular PascalCase form, __tablename__ is the plural snake_case form), following this exact pattern (adapt columns/tables to the app, keep the same import style — every column helper used must be imported from 'sqlalchemy', and \`Base\` must be imported from \`database\` exactly as shown). If the app needs a relationship between two tables, use a plain \`Column(Integer, ForeignKey("other_table.id"))\` exactly as shown — do not import or use \`relationship\`, \`backref\`, or any ORM relationship helper; keep this to the raw foreign-key column only:\n\n${example}`,
  });
}

async function generateMainFile(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
  modelsFileContent: string;
}): Promise<string> {
  const example = `from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import Base, engine, get_db
from models import Trail

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Trail Finder", description="Discover and rate hiking trails near you.")


class TrailCreate(BaseModel):
    name: str
    description: str | None = None
    rating: int | None = None


@app.get("/")
def read_root():
    return {"app": "Trail Finder", "description": "Discover and rate hiking trails near you."}


@app.get("/trails")
def list_trails(db: Session = Depends(get_db)):
    return db.query(Trail).all()


@app.post("/trails", status_code=201)
def create_trail(payload: TrailCreate, db: Session = Depends(get_db)):
    trail = Trail(**payload.model_dump())
    db.add(trail)
    db.commit()
    db.refresh(trail)
    return trail`;

  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 700,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nThis is the model already defined in models.py:\n\n${input.modelsFileContent}\n\nWrite main.py with a FastAPI app titled and described to match this exact app idea (not generic placeholder text — this doubles as the app's only "homepage", shown at the root "/" and in the auto-generated /docs page), plus GET (list) and POST (create) handlers for "${input.mainResourceName}", following this exact pattern — import the model class from \`models\` and the db session/engine from \`database\` exactly as shown. Critically, the POST handler must NEVER accept a raw dict body: define a Pydantic request model listing only the resource's own writable fields (skip \`id\`, \`created_at\`, and any other auto-generated/computed column) and use \`payload.model_dump()\` to build the row, exactly as shown, so a caller can't inject values for columns that don't belong in a create request:\n\n${example}`,
  });
}

/**
 * FastAPI counterpart to lib/llm/boilerplate.ts's generateBoilerplateFillIn — same v1 scope (one
 * representative slice: model + one set of routes), same "no fallbackModel, fail fast" reasoning
 * (PRD §7). Simpler than the Next.js version: FastAPI has no file-based routing convention, so
 * the resource's routes live directly in main.py rather than a separately-named route file —
 * main.py doubles as both "the routes" and "the homepage" (its title/description is what a
 * visitor sees at "/" and in the auto-generated /docs page), so there's no separate homepage
 * call the way the Next.js template needs one.
 */
export async function generateFastapiFillIn(input: {
  prompt: string;
  sections: PrdSection[];
}): Promise<FastapiFillIn> {
  const mainResourceName = await pickResourceName(input);
  const modelsFileContent = await generateModelsFile({ ...input, mainResourceName });
  const mainFileContent = await generateMainFile({ ...input, mainResourceName, modelsFileContent });

  return { mainResourceName, modelsFileContent, mainFileContent };
}
