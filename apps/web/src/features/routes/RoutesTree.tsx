import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import {
  BuildFolder,
  BuildHTTPRoute,
  addFolderMutator,
  addRouteMutator,
  getRouteOrFolderInsertPosition,
  removeRouteMutator,
  updateFolderMutator,
  type Environment,
  type Folder,
  type Route,
} from '@mockoon/commons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { MenuButton, MenuList, type MenuItem } from '../../components/Menu';
import { Modal } from '../../components/Modal';
import { duplicateRoute } from '../../lib/clone';
import { isEditableTarget, isModifier } from '../../lib/keyboard';
import { methodBadge } from '../../lib/method';
import {
  canDrop,
  folderContent,
  moveNode,
  neighborRoute,
  removeFolderKeepChildren,
  siblingOf,
  toggleFolderRoutes,
  type DropPosition,
} from '../../lib/route-actions';
import { filterTree, findDuplicateRoutes, flattenTree, type TreeNode } from '../../lib/routes-tree';
import { useEnvironmentStore } from '../../store/environment-store';
import { S } from '../../strings';
import styles from './RoutesTree.module.css';

type RoutesTreeProps = {
  environment: Environment;
  envUuid: string;
  tree: TreeNode[];
  selectedUuid: string | null;
};

type DropTarget = { uuid: string; position: DropPosition };

type RowProps = {
  node: TreeNode;
  dragDisabled: boolean;
  drop: DropPosition | null;
  className: string;
  selected: boolean;
  tabIndex: number;
  expanded?: boolean;
  label: string;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  children: React.ReactNode;
};

function Row({ node, dragDisabled, drop, className, children, ...rest }: RowProps) {
  const draggable = useDraggable({ id: node.uuid, disabled: dragDisabled });
  const droppable = useDroppable({ id: node.uuid, disabled: dragDisabled });
  const setRef = (element: HTMLDivElement | null) => {
    draggable.setNodeRef(element);
    droppable.setNodeRef(element);
  };

  return (
    <div
      ref={setRef}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={rest.selected}
      aria-expanded={rest.expanded}
      aria-label={rest.label}
      tabIndex={rest.tabIndex}
      data-uuid={node.uuid}
      data-kind={node.kind}
      className={[
        styles.row,
        className,
        rest.selected ? styles.selected : '',
        draggable.isDragging ? styles.dragging : '',
        drop ? styles[`drop-${drop}`] : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 8 + node.depth * 16 }}
      onClick={rest.onClick}
      onContextMenu={rest.onContextMenu}
      onPointerDown={draggable.listeners?.onPointerDown as React.PointerEventHandler | undefined}
    >
      {children}
    </div>
  );
}

export function RoutesTree({ environment, envUuid, tree, selectedUuid }: RoutesTreeProps) {
  const navigate = useNavigate();
  const mutate = useEnvironmentStore((store) => store.mutate);
  const disabledRoutes = useEnvironmentStore((store) => store.disabledRoutes);
  const collapsedFolders = useEnvironmentStore((store) => store.collapsedFolders);
  const setDisabledRoutes = useEnvironmentStore((store) => store.setDisabledRoutes);
  const setCollapsedFolders = useEnvironmentStore((store) => store.setCollapsedFolders);

  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ uuid: string; x: number; y: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const [deletingRoute, setDeletingRoute] = useState<Route | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const routes = useMemo(
    () => new Map(environment.routes.map((route) => [route.uuid, route])),
    [environment.routes],
  );
  const folders = useMemo(
    () => new Map(environment.folders.map((folder) => [folder.uuid, folder])),
    [environment.folders],
  );
  const duplicates = useMemo(() => findDuplicateRoutes(environment.routes), [environment.routes]);
  const disabled = useMemo(() => new Set(disabledRoutes), [disabledRoutes]);
  const collapsed = useMemo(() => new Set(collapsedFolders), [collapsedFolders]);

  const filtering = filter.trim() !== '';
  const rows = useMemo(
    () =>
      filtering
        ? // while filtering only matching routes and their folders are shown, all expanded
          flattenTree(filterTree(tree, environment.routes, filter), new Set())
        : flattenTree(tree, collapsed),
    [filtering, tree, environment.routes, filter, collapsed],
  );

  const select = useCallback(
    (uuid: string | null, focusPath = false) =>
      navigate(uuid ? `/env/${envUuid}/routes/${uuid}` : `/env/${envUuid}/routes`, {
        state: focusPath ? { focusPath: true } : undefined,
      }),
    [navigate, envUuid],
  );

  // ----- actions -------------------------------------------------------------------------------

  const expandFolder = (uuid: string) => {
    if (collapsed.has(uuid)) {
      setCollapsedFolders(collapsedFolders.filter((item) => item !== uuid));
    }
  };

  const addRoute = useCallback(
    (folderUuid?: string) => {
      const route = BuildHTTPRoute(true);
      mutate((current) => {
        if (folderUuid) {
          return addRouteMutator(current, route, folderUuid);
        }
        // right after the selected route, in the same parent; otherwise at the end of the root
        if (selectedUuid && current.routes.some((item) => item.uuid === selectedUuid)) {
          const position = getRouteOrFolderInsertPosition(current, selectedUuid);

          return addRouteMutator(current, route, position.parentId, selectedUuid);
        }

        return addRouteMutator(current, route, 'root');
      });
      setFilter('');
      select(route.uuid, true);
    },
    [mutate, selectedUuid, select],
  );

  const addFolder = () => {
    const folder = { ...BuildFolder(), name: S.routes.newFolderName };
    mutate((current) => addFolderMutator(current, folder, 'root'));
    setFilter('');
    setRenaming(folder.uuid);
  };

  const duplicate = useCallback(
    (uuid: string) => {
      let created: string | null = null;
      mutate((current) => {
        const result = duplicateRoute(current, uuid);
        created = result.newRouteUuid;

        return result.environment;
      });
      if (created) {
        select(created);
      }
    },
    [mutate, select],
  );

  const deleteRoute = (uuid: string) => {
    const next = neighborRoute(tree, uuid);
    mutate((current) => removeRouteMutator(current, uuid));
    if (disabled.has(uuid)) {
      setDisabledRoutes(disabledRoutes.filter((item) => item !== uuid));
    }
    if (selectedUuid === uuid) {
      select(next);
    }
  };

  const toggleRoute = (uuid: string) =>
    setDisabledRoutes(
      disabled.has(uuid)
        ? disabledRoutes.filter((item) => item !== uuid)
        : [...disabledRoutes, uuid],
    );

  const toggleCollapsed = (uuid: string) =>
    setCollapsedFolders(
      collapsed.has(uuid)
        ? collapsedFolders.filter((item) => item !== uuid)
        : [...collapsedFolders, uuid],
    );

  const move = (uuid: string, direction: 'up' | 'down') => {
    const sibling = siblingOf(tree, uuid, direction);
    if (sibling) {
      mutate((current) =>
        moveNode(current, tree, uuid, sibling, direction === 'up' ? 'before' : 'after'),
      );
    }
  };

  // ----- shortcuts -----------------------------------------------------------------------------

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!isModifier(event) || isEditableTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.altKey && key === 'n') {
        event.preventDefault();
        addRoute();
      } else if (!event.altKey && !event.shiftKey && key === 'd' && selectedUuid) {
        event.preventDefault();
        duplicate(selectedUuid);
      } else if (!event.altKey && !event.shiftKey && key === 'f') {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener('keydown', listener);

    return () => window.removeEventListener('keydown', listener);
  }, [addRoute, duplicate, selectedUuid]);

  const onTreeKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'treeitem') {
      return;
    }
    const uuid = target.dataset.uuid ?? '';
    const kind = target.dataset.kind;
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(target);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[index + 1]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[index - 1]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'ArrowRight':
        if (kind === 'folder' && collapsed.has(uuid)) {
          event.preventDefault();
          toggleCollapsed(uuid);
        }
        break;
      case 'ArrowLeft':
        if (kind === 'folder' && !collapsed.has(uuid)) {
          event.preventDefault();
          toggleCollapsed(uuid);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (kind === 'folder') {
          toggleCollapsed(uuid);
        } else {
          select(uuid);
        }
        break;
      case 'F2':
        if (kind === 'folder') {
          event.preventDefault();
          setRenaming(uuid);
        }
        break;
      case 'Delete':
        event.preventDefault();
        if (kind === 'folder') {
          setDeletingFolder(folders.get(uuid) ?? null);
        } else {
          setDeletingRoute(routes.get(uuid) ?? null);
        }
        break;
    }
  };

  // ----- drag and drop -------------------------------------------------------------------------

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragDisabled = filtering || renaming !== null;

  const computeDrop = (event: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const { active, over, delta, activatorEvent } = event;
    if (!over || active.id === over.id) {
      return null;
    }
    const startY = (activatorEvent as PointerEvent).clientY;
    const ratio = (startY + delta.y - over.rect.top) / Math.max(1, over.rect.height);
    const targetUuid = String(over.id);
    const isFolder = folders.has(targetUuid);
    const position: DropPosition = isFolder
      ? ratio < 0.25
        ? 'before'
        : ratio > 0.75
          ? 'after'
          : 'inside'
      : ratio < 0.5
        ? 'before'
        : 'after';

    return canDrop(environment, tree, String(active.id), targetUuid, position)
      ? { uuid: targetUuid, position }
      : null;
  };

  const onDragEnd = (event: DragEndEvent) => {
    const target = computeDrop(event);
    setDropTarget(null);
    if (!target) {
      return;
    }
    mutate((current) =>
      moveNode(current, tree, String(event.active.id), target.uuid, target.position),
    );
    if (target.position === 'inside') {
      expandFolder(target.uuid);
    }
  };

  // ----- menus ---------------------------------------------------------------------------------

  const menuItems = (uuid: string): MenuItem[] => {
    const route = routes.get(uuid);
    const reorder: MenuItem[] = [
      {
        label: S.common.moveUp,
        disabled: filtering || siblingOf(tree, uuid, 'up') === null,
        onSelect: () => move(uuid, 'up'),
      },
      {
        label: S.common.moveDown,
        disabled: filtering || siblingOf(tree, uuid, 'down') === null,
        onSelect: () => move(uuid, 'down'),
      },
    ];
    if (route) {
      return [
        { label: S.routes.menu.duplicate, onSelect: () => duplicate(uuid) },
        {
          label: disabled.has(uuid) ? S.routes.menu.enable : S.routes.menu.disable,
          onSelect: () => toggleRoute(uuid),
        },
        'separator',
        ...reorder,
        'separator',
        {
          label: S.routes.menu.delete,
          danger: true,
          confirm: true,
          onSelect: () => deleteRoute(uuid),
        },
      ];
    }
    const folder = folders.get(uuid);
    if (!folder) {
      return [];
    }
    const content = folderContent(environment, uuid);
    const allDisabled =
      content.routes > 0 &&
      toggleFolderRoutes(environment, uuid, disabledRoutes).length < disabledRoutes.length;

    return [
      { label: S.routes.menu.addRouteHere, onSelect: () => (expandFolder(uuid), addRoute(uuid)) },
      { label: S.routes.menu.rename, onSelect: () => setRenaming(uuid) },
      {
        label: allDisabled ? S.routes.menu.enableAll : S.routes.menu.disableAll,
        disabled: content.routes === 0,
        onSelect: () => setDisabledRoutes(toggleFolderRoutes(environment, uuid, disabledRoutes)),
      },
      'separator',
      ...reorder,
      'separator',
      {
        label: S.routes.menu.deleteFolder,
        danger: true,
        onSelect: () => setDeletingFolder(folder),
      },
    ];
  };

  const openMenu = (uuid: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ uuid, x: event.clientX, y: event.clientY });
  };

  const menuButton = (uuid: string, name: string) => (
    <span className={styles.rowMenu} onClick={(event) => event.stopPropagation()}>
      <MenuButton
        size="small"
        variant="ghost"
        icon="dots"
        iconOnly
        label={S.routes.actionsFor(name)}
        tabIndex={-1}
        items={() => menuItems(uuid)}
      />
    </span>
  );

  const firstFocusable =
    selectedUuid && rows.some((row) => row.uuid === selectedUuid) ? selectedUuid : rows[0]?.uuid;

  // ----- render --------------------------------------------------------------------------------

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <input
          ref={filterRef}
          className="input"
          type="search"
          placeholder={S.routes.filter}
          aria-label={S.routes.filterLabel}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setFilter('');
            }
          }}
        />
        <MenuButton
          icon="plus"
          iconOnly
          label={S.routes.addMenu}
          items={[
            { label: S.routes.addHttpRoute, onSelect: () => addRoute() },
            { label: S.routes.addFolder, onSelect: addFolder },
          ]}
        />
      </div>

      {environment.routes.length === 0 && environment.folders.length === 0 ? (
        <div className="center">
          <p>{S.routes.emptyTitle}</p>
          <Button variant="primary" icon="plus" onClick={() => addRoute()}>
            {S.routes.emptyAction}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="center">{S.routes.noMatch}</div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragMove={(event) => setDropTarget(computeDrop(event))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDropTarget(null)}
        >
          <div
            ref={treeRef}
            className={styles.tree}
            role="tree"
            aria-label={S.routes.treeLabel}
            onKeyDown={onTreeKeyDown}
          >
            {rows.map((node) => {
              const drop = dropTarget?.uuid === node.uuid ? dropTarget.position : null;
              const tabIndex = node.uuid === firstFocusable ? 0 : -1;

              if (node.kind === 'folder') {
                const folder = folders.get(node.uuid);
                if (!folder) {
                  return null;
                }
                const isCollapsed = !filtering && collapsed.has(node.uuid);

                return (
                  <Row
                    key={node.uuid}
                    node={node}
                    dragDisabled={dragDisabled}
                    drop={drop}
                    className={styles.folder ?? ''}
                    selected={false}
                    expanded={!isCollapsed}
                    tabIndex={tabIndex}
                    label={folder.name}
                    onClick={() => toggleCollapsed(node.uuid)}
                    onContextMenu={openMenu(node.uuid)}
                  >
                    <span className={styles.chevron} aria-hidden="true">
                      <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                    </span>
                    <Icon name="folder" size={14} />
                    {renaming === node.uuid ? (
                      <RenameInput
                        initial={folder.name}
                        onCommit={(name) => {
                          setRenaming(null);
                          if (name.trim() && name !== folder.name) {
                            mutate((current) =>
                              updateFolderMutator(current, node.uuid, { name: name.trim() }),
                            );
                          }
                        }}
                        onCancel={() => setRenaming(null)}
                      />
                    ) : (
                      <span
                        className={`${styles.folderName} truncate`}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setRenaming(node.uuid);
                        }}
                      >
                        {folder.name}
                      </span>
                    )}
                    {menuButton(node.uuid, folder.name)}
                  </Row>
                );
              }

              const route = routes.get(node.uuid);
              if (!route) {
                return null;
              }
              const badge = methodBadge(route);
              const path = `/${route.endpoint}`;
              const isDisabled = disabled.has(route.uuid);
              const documentation = route.documentation.split('\n')[0]?.trim();

              return (
                <Row
                  key={node.uuid}
                  node={node}
                  dragDisabled={dragDisabled}
                  drop={drop}
                  className={isDisabled ? (styles.disabled ?? '') : ''}
                  selected={selectedUuid === node.uuid}
                  tabIndex={tabIndex}
                  label={`${badge.label} ${path}${isDisabled ? ` (${S.routes.disabled})` : ''}`}
                  onClick={() => select(node.uuid)}
                  onContextMenu={openMenu(node.uuid)}
                >
                  <span className={badge.className}>{badge.label}</span>
                  <span className={styles.routeText}>
                    <span className={`${styles.path} truncate`}>{path}</span>
                    {documentation && (
                      <span className={`${styles.doc} truncate`}>{documentation}</span>
                    )}
                  </span>
                  {duplicates.has(route.uuid) && (
                    <span
                      className={styles.warning}
                      role="img"
                      aria-label={S.routes.duplicateWarning}
                      title={S.routes.duplicateWarning}
                    >
                      <Icon name="warning" size={14} />
                    </span>
                  )}
                  {route.responses.length > 1 && (
                    <span className="badge" title={S.routes.responses(route.responses.length)}>
                      {route.responses.length}
                    </span>
                  )}
                  {menuButton(node.uuid, path)}
                </Row>
              );
            })}
          </div>
        </DndContext>
      )}

      {menu && (
        <MenuList
          position={{ x: menu.x, y: menu.y }}
          items={menuItems(menu.uuid)}
          onClose={() => setMenu(null)}
        />
      )}

      {deletingFolder && (
        <Modal
          title={S.dialogs.deleteFolderTitle(deletingFolder.name)}
          onClose={() => setDeletingFolder(null)}
          onSubmit={() => {
            mutate((current) => removeFolderKeepChildren(current, deletingFolder.uuid));
            setDeletingFolder(null);
          }}
          footer={
            <>
              <Button onClick={() => setDeletingFolder(null)}>{S.common.cancel}</Button>
              <Button type="submit" variant="danger" data-autofocus>
                {S.dialogs.deleteFolderConfirm}
              </Button>
            </>
          }
        >
          {(() => {
            const content = folderContent(environment, deletingFolder.uuid);

            return <p>{S.dialogs.deleteFolderBody(content.routes, content.folders)}</p>;
          })()}
        </Modal>
      )}

      {deletingRoute && (
        <Modal
          title={`${S.common.delete} ${methodBadge(deletingRoute).label} /${deletingRoute.endpoint}?`}
          onClose={() => setDeletingRoute(null)}
          onSubmit={() => {
            deleteRoute(deletingRoute.uuid);
            setDeletingRoute(null);
          }}
          footer={
            <>
              <Button onClick={() => setDeletingRoute(null)}>{S.common.cancel}</Button>
              <Button type="submit" variant="danger" data-autofocus>
                {S.common.delete}
              </Button>
            </>
          }
        >
          <p>{S.routes.responses(deletingRoute.responses.length)}</p>
        </Modal>
      )}
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  return (
    <input
      ref={ref}
      className={`input ${styles.rename}`}
      aria-label={S.routes.folderName}
      value={value}
      maxLength={100}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={() => {
        if (!done.current) {
          done.current = true;
          onCommit(value);
        }
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          done.current = true;
          onCommit(value);
        } else if (event.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}
