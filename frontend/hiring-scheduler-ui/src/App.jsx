import { useEffect, useMemo, useState, useRef } from "react";
import html2canvas from "html2canvas"; // Import the library
import "./App.css";

const API = "http://localhost:8000";
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "Request failed");
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "Request failed");
  return data;
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || "Delete failed");
  return data;
}

function to12HourStr(hhmm) {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function TimeSelect({ value, onChange }) {
  const [hStr, mStr] = (value || "00:00").split(":");
  let h24 = parseInt(hStr, 10);
  let ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

  const handleChange = (newH12, newMin, newAmpm) => {
    let finalH = parseInt(newH12, 10);
    if (newAmpm === "AM" && finalH === 12) finalH = 0;
    if (newAmpm === "PM" && finalH !== 12) finalH += 12;
    const hString = String(finalH).padStart(2, "0");
    onChange(`${hString}:${newMin}`);
  };

  return (
    <div className="time-select-container">
      <select value={h12} onChange={(e) => handleChange(e.target.value, mStr, ampm)}>
        {hours.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{alignSelf:"center", fontWeight:"bold"}}>:</span>
      <select value={mStr} onChange={(e) => handleChange(h12, e.target.value, ampm)}>
        {minutes.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={ampm} onChange={(e) => handleChange(h12, mStr, e.target.value)}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="field-row">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

// Custom Dropdown Component
function StudentDropdown({ students, active, onSelect, onDelete }) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (s) => {
    onSelect(s);
    setIsOpen(false);
  };

  const handleDelete = (e, s) => {
    e.stopPropagation();
    onDelete(s);
  };

  return (
    <div className="custom-dropdown-container" ref={wrapperRef}>
      <div className="dropdown-trigger" onClick={() => setIsOpen(!isOpen)}>
        {active || "(Select Student)"}
        <span style={{ float: "right", fontSize: "0.8rem", color: "#999" }}>▼</span>
      </div>
      {isOpen && (
        <div className="dropdown-menu">
          {students.length === 0 ? (
            <div style={{ padding: 10, color: "#999", textAlign: "center" }}>(No students)</div>
          ) : (
            students.map((s) => (
              <div 
                key={s} 
                className={`dropdown-item ${s === active ? "selected" : ""}`}
                onClick={() => handleSelect(s)}
              >
                <span>{s}</span>
                <button 
                  className="item-delete-btn"
                  title="Delete Student"
                  onClick={(e) => handleDelete(e, s)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);

  // Refs for capturing the image
  const tableRef = useRef(null);

  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(new Set()); 
  
  const [newName, setNewName] = useState("");
  const [active, setActive] = useState("");
  const [day, setDay] = useState("Tue");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:15");

  const [daysShown, setDaysShown] = useState(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [gridStart, setGridStart] = useState("08:00");
  const [gridEnd, setGridEnd] = useState("20:00");
  const [slotMinutes, setSlotMinutes] = useState(15);
  const [grid, setGrid] = useState(null);

  async function refreshStudents({ autoSelectAll = false } = {}) {
    const data = await apiGet("/students");
    const list = data.students || [];
    setStudents(list);

    if (!list.includes(active)) setActive("");
    if (!active && list.length) setActive(list[0]);

    setSelected((prev) => {
      const next = new Set(prev);
      for (const name of Array.from(next)) {
        if (!list.includes(name)) next.delete(name);
      }
      if (autoSelectAll && next.size === 0) {
        for (const name of list) next.add(name);
      }
      return next;
    });
  }

  useEffect(() => {
    refreshStudents({ autoSelectAll: true }).catch((e) =>
      setStatus({ msg: `Backend error: ${e.message}`, type: "error" })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addStudent() {
    setStatus(null);
    try {
      await apiPost("/students", { name: newName });
      const created = newName;
      setNewName("");
      await refreshStudents();
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(created.trim());
        return next;
      });
      setStatus({ msg: `Student "${created}" added successfully.`, type: "success" });
    } catch (e) {
      setStatus({ msg: e.message, type: "error" });
    }
  }

  async function deleteStudent(studentName) {
    setStatus(null);
    if (!window.confirm(`Are you sure you want to delete ${studentName}?`)) return;
    try {
      await apiDelete(`/students/${studentName}`);
      setStatus({ msg: `Student "${studentName}" deleted.`, type: "success" });
      if (active === studentName) setActive(""); 
      await refreshStudents();
    } catch (e) {
      setStatus({ msg: e.message, type: "error" });
    }
  }

  async function addBusyBlock() {
    setStatus(null);
    if (!active) {
      setStatus({ msg: "Select a student first.", type: "error" });
      return;
    }
    try {
      await apiPost("/busy", { name: active, day, start, end });
      setStatus({ msg: "Busy schedule added.", type: "success" });
    } catch (e) {
      setStatus({ msg: e.message, type: "error" });
    }
  }

  async function loadAvailabilityGrid() {
    setStatus(null);
    try {
      const data = await apiPost("/availability-grid", {
        days: daysShown,
        start_time: gridStart,
        end_time: gridEnd,
        slot_minutes: Number(slotMinutes),
        mode: "free",
      });

      const selectedArr = Array.from(selected);
      const filteredGrid = {};
      for (const d of data.days) {
        filteredGrid[d] = data.grid[d].map((cell) => {
          const names = (cell.names || []).filter((n) => selectedArr.includes(n));
          return { ...cell, names };
        });
      }

      setGrid({ ...data, grid: filteredGrid, selected: selectedArr });
      setStatus({ msg: "Timetable updated.", type: "success" });
    } catch (e) {
      setStatus({ msg: e.message, type: "error" });
    }
  }

  // --- NEW: Download as Image Function ---
  async function downloadImage() {
    if (!tableRef.current) return;
    
    // We target the tableRef. 
    // We add some options to ensure it looks good (backgroundColor: white).
    const canvas = await html2canvas(tableRef.current, {
      backgroundColor: "#ffffff",
      scale: 2, // Higher scale for better resolution
    });

    const image = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = image;
    link.download = "Hiring_Schedule.png";
    link.click();
  }

  const rowTimes = useMemo(() => {
    if (!grid) return [];
    const firstDay = grid.days[0];
    return grid.grid[firstDay].map((slot) => slot.start);
  }, [grid]);

  return (
    <div className="app-container">
      <h1>Kalachandjis Express Hiring Schedule</h1>
      
      {status && (
        <div className={`status-msg ${status.type}`}>
          {status.msg}
        </div>
      )}

      <div className="dashboard">
        <div className="top-row">
          
          <div className="card red-accent">
            <h2>Manage Data</h2>
            
            <Field label="Add New Student">
              <div className="input-group">
                <input
                  className="input-full"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                />
                <button onClick={addStudent} className="btn-orange btn-small">Add</button>
              </div>
            </Field>

            <h3>Add Busy Time</h3>
            <Field label="Who?">
              <StudentDropdown 
                students={students}
                active={active}
                onSelect={setActive}
                onDelete={deleteStudent}
              />
            </Field>

            <Field label="Day">
              <select className="input-full" value={day} onChange={(e) => setDay(e.target.value)}>
                {ALL_DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Start Time">
                <TimeSelect value={start} onChange={setStart} />
              </Field>
              <Field label="End Time">
                <TimeSelect value={end} onChange={setEnd} />
              </Field>
            </div>
            
            <button onClick={addBusyBlock} className="btn-red">
              Add Busy Block
            </button>
          </div>

          <div className="card orange-accent">
            <h2>Generate Timetable</h2>
            
            <Field label="Show Students">
              <div className="checkbox-group" style={{marginBottom: 10}}>
                <button className="btn-secondary" onClick={() => setSelected(new Set(students))}>All</button>
                <button className="btn-secondary" onClick={() => setSelected(new Set())}>None</button>
              </div>
              <div className="checkbox-group">
                {students.map((s) => (
                  <label key={s} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selected.has(s)}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(s) : next.delete(s);
                          return next;
                        });
                      }}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </Field>

            <hr style={{border:0, borderTop:"1px solid #eee", margin:"20px 0"}} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
               <Field label="Grid Start">
                  <TimeSelect value={gridStart} onChange={setGridStart} />
               </Field>
               <Field label="Grid End">
                  <TimeSelect value={gridEnd} onChange={setGridEnd} />
               </Field>
            </div>

            <Field label="Slot Duration (min)">
               <select className="input-full" value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
                 {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m}</option>)}
               </select>
            </Field>

            <Field label="Days to Show">
               <div className="checkbox-group">
                 {ALL_DAYS.map((d) => (
                   <label key={d} className="checkbox-item">
                     <input
                       type="checkbox"
                       checked={daysShown.includes(d)}
                       onChange={(e) =>
                         setDaysShown((prev) => e.target.checked ? [...prev, d] : prev.filter((x) => x !== d))
                       }
                     />
                     {d}
                   </label>
                 ))}
               </div>
            </Field>

            <button
              onClick={loadAvailabilityGrid}
              className="btn-orange"
              style={{marginTop: 20}}
              disabled={selected.size === 0}
            >
              Load Timetable
            </button>
          </div>
        </div>

        <div className="bottom-row">
          {grid && (
            // We use the REF here to capture this entire card
            <div 
              ref={tableRef} 
              className="card dark-accent" 
              style={{padding:0, overflow:'hidden', background: '#fff'}}
            >
              <div 
                // We exclude the button from the capture by handling it separately 
                // OR we just capture the whole thing. Usually people want the whole thing.
                // If you want to HIDE the download button in the picture, use data-html2canvas-ignore attribute.
                style={{
                  padding: "15px 20px", 
                  background: "#f9f9f9", 
                  borderBottom: "1px solid #ddd", 
                  display:'flex', 
                  justifyContent:'space-between', 
                  alignItems:'center'
                }}
              >
                <span style={{fontWeight:'bold', color: '#333', fontSize: '1.1rem'}}>
                  Kalachandjis Express Schedule
                </span>
                
                {/* data-html2canvas-ignore makes this button INVISIBLE in the downloaded picture */}
                <button 
                  onClick={downloadImage} 
                  className="btn-download"
                  data-html2canvas-ignore="true"
                >
                  Download Image
                </button>
              </div>

              {/* Added Padding wrapper for readability in the image */}
              <div style={{ padding: "20px" }}>
                <div className="table-wrapper" style={{borderTop: 'none', borderRadius: 0}}>
                  <table>
                    <thead>
                      <tr>
                        <th className="time-header">Time</th>
                        {grid.days.map((d) => (
                          <th key={d}>{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowTimes.map((t, rowIdx) => (
                        <tr key={t}>
                          <td className="time-header">{to12HourStr(t)}</td>
                          {grid.days.map((d) => {
                            const cell = grid.grid[d][rowIdx];
                            const names = cell.names || [];
                            const isFree = names.length > 0;
                            return (
                              <td key={d} className={isFree ? "slot-free" : "slot-busy"}>
                                <div style={{fontSize: "0.75rem", opacity:0.7, marginBottom:4}}>
                                  {to12HourStr(cell.start)} - {to12HourStr(cell.end)}
                                </div>
                                <div className="slot-names">
                                  {isFree ? names.join(", ") : "Busy"}
                                  {/* For clarity in the image if busy */}
                                  {!isFree && <span style={{display:'none'}}>Busy</span>}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}