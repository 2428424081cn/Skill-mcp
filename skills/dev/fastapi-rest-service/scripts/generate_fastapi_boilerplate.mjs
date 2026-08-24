const model = process.argv[2] || "User";
const lower = model.toLowerCase();

console.log(`# --- FastAPI ${model} 路由模板 ---
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from pydantic import BaseModel

router = APIRouter(prefix="/${lower}s", tags=["${model}s"])

class ${model}Create(BaseModel):
    name: str

class ${model}Out(BaseModel):
    id: int
    name: str

@router.get("/", response_model=List[${model}Out])
async def list_${lower}s():
    return [{"id": 1, "name": "sample"}]

@router.post("/", response_model=${model}Out, status_code=status.HTTP_201_CREATED)
async def create_${lower}(payload: ${model}Create):
    return {"id": 1, "name": payload.name}
`);
