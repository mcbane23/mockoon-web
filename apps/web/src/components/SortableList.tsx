import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type SortableHandleProps = HTMLAttributes<HTMLElement>;

type RenderItem = (args: {
  id: string;
  index: number;
  /** Spread on the element that starts the drag (the whole row or a handle). */
  handleProps: SortableHandleProps;
  isDragging: boolean;
}) => ReactNode;

type SortableListProps = {
  ids: string[];
  /** Called with the old and new index after a drop. */
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  children: RenderItem;
  itemStyle?: CSSProperties;
};

function SortableRow({
  id,
  index,
  disabled,
  render,
  itemStyle,
}: {
  id: string;
  index: number;
  disabled: boolean;
  render: RenderItem;
  itemStyle?: CSSProperties;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...itemStyle,
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: 'relative',
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      {render({
        id,
        index,
        isDragging,
        handleProps: { ...attributes, ...listeners } as SortableHandleProps,
      })}
    </div>
  );
}

/** Vertical list whose rows can be reordered by dragging (mouse, touch or keyboard). */
export function SortableList({
  ids,
  onMove,
  disabled = false,
  children,
  itemStyle,
}: SortableListProps) {
  const sensors = useSensors(
    // a small distance keeps plain clicks working on draggable rows
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) {
      onMove(from, to);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id, index) => (
          <SortableRow
            key={id}
            id={id}
            index={index}
            disabled={disabled}
            render={children}
            itemStyle={itemStyle}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

/** Move an item of an array to another index (returns a new array). */
export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) {
    next.splice(to, 0, moved);
  }

  return next;
}
