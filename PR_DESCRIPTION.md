# Fix drag-and-drop snap-back & implement Driver Pool Sidebar

## Summary

This PR fixes the drag-and-drop snap-back issue and implements Phase 1 of the Driver Pool Sidebar feature for improved driver assignment workflow.

### 🐛 Bug Fixes

**Fixed drag-and-drop snap-back behavior:**
- Items were snapping back to original position after drag-and-drop
- Implemented sequential mutations to prevent race conditions
- Added DragOverlay component for proper visual feedback
- Original elements now stay in place during drag (no snap-back)

### ✨ New Features

**Phase 1: Driver Pool Sidebar**
- Left sidebar with searchable driver pool
- Three categorized sections:
  - **Available**: Unassigned, active, load-eligible drivers (draggable)
  - **Assigned**: Currently scheduled drivers with assignment details
  - **Unavailable**: Inactive or non-load-eligible drivers
- Drag-and-drop driver assignment from sidebar to calendar
- Unassign driver button (drivers return to Available pool)
- Collapsible sections with driver counts
- Real-time search/filter functionality

### 🔧 Technical Changes

**Drag-and-Drop Improvements:**
1. Sequential mutations with `mutateAsync` instead of parallel `mutate` calls
2. DragOverlay component for floating visual during drag
3. Dual drag sources support:
   - Sidebar drivers → Calendar cells (assign)
   - Calendar cells → Calendar cells (swap/move)
4. Single query invalidation after all mutations complete

**New Components:**
- `DriverPoolSidebar.tsx` - Sidebar component with driver categorization

**Modified Components:**
- `Schedules.tsx` - Integrated sidebar, updated drag handlers, added unassign functionality

### 📊 Benefits

- ✅ No more snap-back on drag-and-drop
- ✅ Easy driver discovery - all drivers visible and searchable
- ✅ Quick assignment - drag from pool to schedule
- ✅ Driver recovery - unassigned drivers return to pool automatically
- ✅ Clear visibility - see who's assigned and who's available
- ✅ Improved UX - smooth animations and visual feedback

### 🧪 Testing

**Test scenarios:**
1. Drag driver from Available section to empty calendar slot ✅
2. Drag between calendar cells to swap drivers ✅
3. Unassign driver using UserMinus button ✅
4. Search for drivers in sidebar ✅
5. View driver assignments in Assigned section ✅

### 📋 Next Steps (Phase 2)

- Validation rules with green/gray visual feedback
- Protected driver rules integration (time-off blocking)
- DOT hours compliance checking
- Real-time validation tooltips

### 🎯 Related Issues

Fixes driver assignment workflow and snap-back bug.

---

**Commits:**
- `ff874a3` - Phase 1: Implement Driver Pool Sidebar with drag-and-drop assignment
- `83bf5dd` - Implement DragOverlay to eliminate snap-back on drag-and-drop
- `02ae4aa` - Fix drag-and-drop snap-back by using sequential mutations
