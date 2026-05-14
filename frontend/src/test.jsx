  return (
    <ErrorBoundary>
    <div className="app-container">
      {/* Create Board Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Create a New Board</h2>
              {boards.length > 0 && (
                <button className="close-modal" onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              )}
            </div>
            <div className="modal-body">
              <input 
                type="text"
                autoFocus
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="Enter board name..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createBoard();
                }}
              />
              <button 
                className="create-btn" 
                onClick={createBoard}
                disabled={!newBoardName.trim() || boards.length >= 10}
              >
                Create New Board
              </button>
              {boards.length >= 10 && (
                <p className="limit-warning">Maximum of 10 boards reached.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Retro Boards</h2>
          <div className="sidebar-actions">
            <button
              className="theme-toggle-btn"
              onClick={() => setIsDarkTheme(!isDarkTheme)}
              title="Toggle Dark Theme"
            >
              {isDarkTheme ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button 
              className="add-board-btn"
              onClick={() => {
                if (boards.length === 0) setIsModalOpen(true);
                else setIsCreatingBoardInline(!isCreatingBoardInline);
              }}
              disabled={boards.length >= 10}
              title={boards.length >= 10 ? "Limit of 10 boards reached" : "Create new board"}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="board-count">{boards.length}/10 Boards</div>
        <ul className="board-list">
          {isCreatingBoardInline && (
            <li className="creating-board-item">
              <input
                autoFocus
                className="inline-board-input"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createBoard();
                  if (e.key === 'Escape') {
                    setIsCreatingBoardInline(false);
                    setNewBoardName('');
                  }
                }}
                placeholder="Board name..."
              />
              <button 
                onClick={createBoard} 
                disabled={!newBoardName.trim()}
                className="inline-create-btn"
              >
                Create
              </button>
            </li>
          )}
          {boards.map(b => {
            const numericId = parseInt(String(b.id).replace(/\D/g, '')) || 0;
            return (
              <li
                key={b.id}
                className={activeBoard?.id === b.id ? 'active' : ''}
                onClick={() => handleBoardClick(b)}
              >
                <button
                  className="delete-board-btn"
                  onClick={(e) => deleteBoard(b.id, e)}
                  title="Delete Board"
                >
                <Trash2 size={14} />
              </button>
              <span className="board-link-text">{b.name}</span>
            </li>
            );
          })}
        </ul>
      </div>

      <div className="board-area">
        {!activeBoard ? (
          <div className="empty-state">
            <p>Select a board from the sidebar to get started.</p>
            <button 
              className="create-btn" 
              style={{ marginTop: '20px' }}
              onClick={() => setIsModalOpen(true)}
            >
              <Plus size={16} style={{ marginRight: '8px' }} />
              Create a New Board
            </button>
          </div>
        ) : (
          <>
            <div className="board-header">
              <div className="board-title-container">
                {isEditingBoard ? (
                  <input
                    autoFocus
                    className="edit-board-input"
                    value={editBoardName}
                    onChange={(e) => setEditBoardName(e.target.value)}
                    onBlur={updateBoardName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') updateBoardName();
                      if (e.key === 'Escape') setIsEditingBoard(false);
                    }}
                  />
                ) : (
                  <h1 className="board-title">
                    {activeBoard.name}
                    <button 
                      className="edit-board-btn" 
                      onClick={() => {
                        setEditBoardName(activeBoard.name);
                        setIsEditingBoard(true);
                      }}
                      title="Edit Board Name"
                    >
                      <Edit2 size={18} />
                    </button>
                  </h1>
                )}
              </div>
              <div className="add-column">
                {isAddingColumn ? (
                  <>
                    <input 
                      autoFocus
                      value={newColName}
                      onChange={e => setNewColName(e.target.value)} 
                      placeholder="New Column Name..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addColumn();
                        if (e.key === 'Escape') {
                          setIsAddingColumn(false);
                          setNewColName('');
                        }
                      }}
                      onBlur={(e) => {
                        if (e.relatedTarget && e.relatedTarget.id === 'save-col-btn') return;
                        setIsAddingColumn(false);
                        setNewColName('');
                      }}
                    />
                    <button id="save-col-btn" onMouseDown={(e) => { e.preventDefault(); addColumn(); }}>Save</button>
                  </>
                ) : (
                  <button onClick={() => setIsAddingColumn(true)}>Add Column</button>
                )}
              </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="board" type="COLUMN" direction="horizontal">
                {(provided) => (
                  <div
                    className="columns-wrapper"
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    {columns.map((col, index) => (
                      <Draggable key={col.id} draggableId={col.id.toString()} index={index}>
                        {(provided) => (
                          <div
                            className="column"
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                          >
                            <div
                              className="column-header"
                              {...provided.dragHandleProps}
                              onMouseEnter={() => setHoveredColumnId(col.id)}
                      onMouseLeave={() => setHoveredColumnId(null)}
                    >
                      <div className="column-header-actions">
                        {hoveredColumnId === col.id && (
                          <button 
                            className="delete-column-btn" 
                            onClick={() => deleteColumn(col.id)}
                            title="Delete Column"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      {editingColumnId === col.id ? (
                        <input
                          autoFocus
                          className="edit-column-input"
                          value={editColumnName}
                          onChange={(e) => setEditColumnName(e.target.value)}
                          onBlur={updateColumnName}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateColumnName();
                            if (e.key === 'Escape') setEditingColumnId(null);
                          }}
                        />
                      ) : (
                        <h3 
                          className="column-title"
                          onClick={() => {
                            setEditingColumnId(col.id);
                            setEditColumnName(col.name);
                          }}
                          title="Click to edit"
                        >
                          {col.name}
                        </h3>
                      )}
                    </div>

                    <div className="add-card-container">
                      {addingCardToColId === col.id ? (
                        <div className="add-card-form">
                          <textarea
                            className="add-card-textarea"
                            placeholder="Enter a title for this card..."
                            autoFocus
                            value={newCardContent}
                            onChange={(e) => setNewCardContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (newCardContent.trim()) {
                                  addCard(col.id, newCardContent.trim());
                                  setNewCardContent('');
                                  setAddingCardToColId(null);
                                }
                              }
                              if (e.key === 'Escape') {
                                setAddingCardToColId(null);
                                setNewCardContent('');
                              }
                            }}
                          />
                          <div className="add-card-actions">
                            <button
                              className="add-card-primary-btn"
                              onClick={() => {
                                if (newCardContent.trim()) {
                                  addCard(col.id, newCardContent.trim());
                                  setNewCardContent('');
                                  setAddingCardToColId(null);
                                }
                              }}
                            >
                              Add card
                            </button>
                            <button
                              className="add-card-cancel"
                              onClick={() => {
                                setAddingCardToColId(null);
                                setNewCardContent('');
                              }}
                            >
                              <X size={20} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="add-card-btn"
                          onClick={() => setAddingCardToColId(col.id)}
                        >
                          <Plus size={16} /> Add a card
                        </button>
                      )}
                    </div>

                    <Droppable droppableId={col.id.toString()}>
                      {(provided) => (
                        <div 
                          className="cards-container"
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                        >
                          {cards
                            .filter(c => c.column_id === col.id)
                            .sort((a,b) => a.position - b.position)
                            .map((card, index) => (
                              <Draggable key={card.id} draggableId={card.id.toString()} index={index}>
                                {(provided) => (
                                  <div
                                    className="card"
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                  >
                                    <div className="card-drag-handle"><GripVertical size={16} /></div>
                                    <div className="card-content-wrapper" style={{ flex: 1 }}>
                                      {editingCardId === card.id ? (
                                        <textarea
                                          autoFocus
                                          className="edit-card-textarea"
                                          value={editCardContent}
                                          onChange={(e) => setEditCardContent(e.target.value)}
                                          onBlur={updateCardContent}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault();
                                              updateCardContent();
                                            }
                                            if (e.key === 'Escape') {
                                              setEditingCardId(null);
                                              setEditCardContent('');
                                            }
                                          }}
                                          onPointerDown={(e) => e.stopPropagation()}
                                        />
                                      ) : (
                                        <div 
                                          className="card-content" 
                                          onClick={(e) => {
                                            if (!provided.dragHandleProps) return;
                                            setEditingCardId(card.id);
                                            setEditCardContent(card.content);
                                          }}
                                        >
                                          {card.content}
                                        </div>
                                      )}
                                    </div>
                                    <button className="del-btn" onClick={() => deleteCard(card.id)}>
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                )}
                              </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
          </>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
}

export default App;
