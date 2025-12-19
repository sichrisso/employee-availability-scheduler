from __future__ import annotations
import os
import json
from typing import Dict, List, Tuple
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# --- Constants & Helpers ---
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DATA_FILE = os.environ.get("SCHEDULE_DATA_FILE", "students_busy.json")

def normalize_name(name: str) -> str:
    name = " ".join(name.strip().split())
    if not name:
        raise ValueError("Name cannot be empty.")
    return name.title()

def parse_time_to_minutes(t: str) -> int:
    t = t.strip()
    hh_mm = t.split(":")
    if len(hh_mm) != 2 or not hh_mm[0].isdigit() or not hh_mm[1].isdigit():
        raise ValueError("Time must be HH:MM")
    h, m = int(hh_mm[0]), int(hh_mm[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("Invalid time.")
    return h * 60 + m

def minutes_to_time_str(x: int) -> str:
    return f"{x//60:02d}:{x%60:02d}"

def normalize_day(day: str) -> str:
    d = day.strip().capitalize()
    if len(d) >= 3: d = d[:3]
    mapping = {
        "Mon": "Mon", "Tue": "Tue", "Wed": "Wed", "Thu": "Thu",
        "Fri": "Fri", "Sat": "Sat", "Sun": "Sun",
        "Tues": "Tue", "Thur": "Thu"
    }
    if d not in mapping:
        raise ValueError(f"Invalid day '{day}'")
    return mapping[d]

def merge_windows(windows: List[Tuple[int,int]]) -> List[Tuple[int,int]]:
    windows = sorted(windows, key=lambda w: (w[0], w[1]))
    if not windows: return []
    merged = [windows[0]]
    for s, e in windows[1:]:
        ps, pe = merged[-1]
        if s <= pe: merged[-1] = (ps, max(pe, e))
        else: merged.append((s, e))
    return merged

def subtract_windows(full: Tuple[int,int], busy: List[Tuple[int,int]]) -> List[Tuple[int,int]]:
    start, end = full
    # Only consider busy blocks that overlap with [start, end]
    busy = merge_windows([w for w in busy if not (w[1] <= start or w[0] >= end)])
    free = []
    cursor = start
    for bs, be in busy:
        if bs > cursor:
            free.append((cursor, bs))
        cursor = max(cursor, be)
    if cursor < end:
        free.append((cursor, end))
    return free

# --- Storage ---
class BusyStore:
    def __init__(self):
        self.busy: Dict[str, Dict[str, List[Tuple[int,int]]]] = {}

    def add_student(self, name: str):
        name = normalize_name(name)
        if name not in self.busy:
            self.busy[name] = {d: [] for d in DAYS}

    def add_busy(self, name: str, day: str, start: str, end: str):
        name = normalize_name(name)
        self.add_student(name)
        d = normalize_day(day)
        s, e = parse_time_to_minutes(start), parse_time_to_minutes(end)
        if e <= s: raise ValueError("End <= Start")
        self.busy[name][d].append((s, e))
        self.busy[name][d] = merge_windows(self.busy[name][d])
    
    # NEW: Method to remove student
    def clear_student(self, name: str):
        name = normalize_name(name)
        if name in self.busy:
            del self.busy[name]

    def list_students(self):
        return sorted(self.busy.keys())

    def save(self, path: str = DATA_FILE):
        out = {name: {d: [{"start": s, "end": e} for s, e in per_day[d]] for d in DAYS} 
               for name, per_day in self.busy.items()}
        with open(path, "w") as f: json.dump(out, f, indent=2)

    @staticmethod
    def load(path: str = DATA_FILE):
        st = BusyStore()
        try:
            with open(path, "r") as f:
                data = json.load(f)
                for name, per_day in data.items():
                    st.add_student(name)
                    for d in DAYS:
                        items = per_day.get(d, [])
                        st.busy[name][d] = merge_windows([(int(x["start"]), int(x["end"])) for x in items])
        except FileNotFoundError: pass
        return st

store = BusyStore.load()
def persist(): store.save()

# --- API Models & App ---
class StudentCreate(BaseModel): name: str
class BusyBlockCreate(BaseModel): name: str; day: str; start: str; end: str
class GridReq(BaseModel): 
    days: List[str]
    start_time: str = "09:00"
    end_time: str = "20:00"
    slot_minutes: int = 15
    mode: str = "free"

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/students")
def get_students(): return {"students": store.list_students()}

@app.post("/students")
def add_student(p: StudentCreate):
    try:
        store.add_student(p.name); persist()
        return {"ok": True}
    except Exception as e: raise HTTPException(400, str(e))

@app.post("/busy")
def add_busy(p: BusyBlockCreate):
    try:
        store.add_busy(p.name, p.day, p.start, p.end); persist()
        return {"ok": True}
    except Exception as e: raise HTTPException(400, str(e))

# NEW: Delete endpoint
@app.delete("/students/{name}")
def delete_student(name: str):
    try:
        store.clear_student(name); persist()
        return {"ok": True}
    except Exception as e: raise HTTPException(400, str(e))

@app.post("/availability-grid")
def grid(req: GridReq):
    try:
        days = [normalize_day(d) for d in req.days]
        s_min, e_min = parse_time_to_minutes(req.start_time), parse_time_to_minutes(req.end_time)
        
        full = (s_min, e_min)
        free_by_student = {}
        for name in store.list_students():
            free_by_student[name] = {}
            for d in days:
                free_by_student[name][d] = subtract_windows(full, store.busy[name][d])
        
        grid_data = {d: [] for d in days}
        slots = []
        t = s_min
        while t + req.slot_minutes <= e_min:
            slots.append((t, t + req.slot_minutes))
            t += req.slot_minutes
            
        for d in days:
            for s, e in slots:
                names_free = []
                for name in store.list_students():
                    if any(s >= fs and e <= fe for fs, fe in free_by_student[name][d]):
                        names_free.append(name)
                
                grid_data[d].append({
                    "start": minutes_to_time_str(s),
                    "end": minutes_to_time_str(e),
                    "names": names_free
                })
        
        return {"days": days, "grid": grid_data}
    except Exception as e: raise HTTPException(400, str(e))