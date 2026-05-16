-- ============================================================
-- Retro Board — MS SQL Server Schema
-- Run this against a fresh database to create all tables.
-- ============================================================

-- 1. Users
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    username NVARCHAR(100) NOT NULL,
    first_name NVARCHAR(100) NOT NULL DEFAULT '',
    last_name NVARCHAR(100) NOT NULL DEFAULT '',
    display_name NVARCHAR(150) NOT NULL,
    email NVARCHAR(255) NOT NULL,
    department NVARCHAR(10) NOT NULL DEFAULT 'QA',
    [lead] NVARCHAR(150) NULL,
    is_admin BIT NOT NULL DEFAULT 0,
    is_master BIT NOT NULL DEFAULT 0,
    is_overlord BIT NOT NULL DEFAULT 0,
    password_hash NVARCHAR(255) NULL,
    email_verified_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_users_username UNIQUE (username),
    CONSTRAINT UQ_users_email UNIQUE (email),
    CONSTRAINT CK_users_department CHECK (department IN ('QA','SE','SDET'))
);

IF COL_LENGTH('users', 'email_verified_at') IS NULL
    ALTER TABLE users ADD email_verified_at DATETIME2 NULL;

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'email_verification_tokens')
CREATE TABLE email_verification_tokens (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash NVARCHAR(128) NOT NULL UNIQUE,
    expires_at DATETIME2 NOT NULL,
    used_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_email_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'password_reset_tokens')
CREATE TABLE password_reset_tokens (
    id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash NVARCHAR(128) NOT NULL UNIQUE,
    expires_at DATETIME2 NOT NULL,
    used_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Boards
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'boards')
CREATE TABLE boards (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    department NVARCHAR(10) NOT NULL DEFAULT 'QA',
    owner_user_id INT NULL,
    bg_image NVARCHAR(MAX) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_boards_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT CK_boards_department CHECK (department IN ('QA','SE','SDET'))
);

-- 3. Columns (reserved word — always use [columns])
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'columns')
CREATE TABLE [columns] (
    id INT IDENTITY(1,1) PRIMARY KEY,
    board_id INT NOT NULL,
    name NVARCHAR(255) NOT NULL,
    position INT NOT NULL,
    CONSTRAINT FK_columns_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

-- 4. Cards
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cards')
CREATE TABLE cards (
    id INT IDENTITY(1,1) PRIMARY KEY,
    column_id INT NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    position INT NOT NULL,
    created_by NVARCHAR(255) NULL,
    created_by_user_id INT NULL,
    image_url NVARCHAR(MAX) NULL,
    deleted_at DATETIME2 NULL,
    CONSTRAINT FK_cards_column FOREIGN KEY (column_id) REFERENCES [columns](id) ON DELETE CASCADE,
    CONSTRAINT FK_cards_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 5. Role Labels
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'role_labels')
CREATE TABLE role_labels (
    id INT IDENTITY(1,1) PRIMARY KEY,
    role_key NVARCHAR(50) NOT NULL,
    label NVARCHAR(100) NOT NULL,
    CONSTRAINT UQ_role_labels_key UNIQUE (role_key)
);

-- 6. Admin Emails
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'admin_emails')
CREATE TABLE admin_emails (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL,
    department NVARCHAR(10) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_admin_emails UNIQUE (email),
    CONSTRAINT CK_admin_dept CHECK (department IS NULL OR department IN ('QA','SE','SDET'))
);

-- 7. Master Emails
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'master_emails')
CREATE TABLE master_emails (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL,
    department NVARCHAR(10) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_master_emails UNIQUE (email),
    CONSTRAINT CK_master_dept CHECK (department IS NULL OR department IN ('QA','SE','SDET'))
);

-- 7b. Overlord Emails
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'overlord_emails')
CREATE TABLE overlord_emails (
    id INT IDENTITY(1,1) PRIMARY KEY,
    email NVARCHAR(255) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_overlord_emails UNIQUE (email)
);

-- 8. Board Members
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'board_members')
CREATE TABLE board_members (
    id INT IDENTITY(1,1) PRIMARY KEY,
    board_id INT NOT NULL,
    user_id INT NOT NULL,
    added_by INT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_board_member UNIQUE (board_id, user_id),
    CONSTRAINT FK_bm_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    CONSTRAINT FK_bm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. GIFs
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'gifs')
CREATE TABLE gifs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    url NVARCHAR(MAX) NOT NULL,
    preview_url NVARCHAR(MAX) NULL,
    title NVARCHAR(255) DEFAULT '',
    added_by INT NULL,
    is_default BIT DEFAULT 0,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_gifs_user FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 10. Card Reactions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'card_reactions')
CREATE TABLE card_reactions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    card_id INT NOT NULL,
    user_id INT NOT NULL,
    emoji NVARCHAR(20) NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_card_reaction UNIQUE (card_id, user_id, emoji),
    CONSTRAINT FK_reaction_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    CONSTRAINT FK_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- Performance Indexes
-- ============================================================
CREATE NONCLUSTERED INDEX IX_cards_column_deleted ON cards (column_id, deleted_at);
CREATE NONCLUSTERED INDEX IX_columns_board ON [columns] (board_id, position);
CREATE NONCLUSTERED INDEX IX_boards_department ON boards (department);
CREATE NONCLUSTERED INDEX IX_boards_name ON boards (name);
CREATE NONCLUSTERED INDEX IX_gifs_default ON gifs (is_default);
CREATE NONCLUSTERED INDEX IX_card_reactions_card ON card_reactions (card_id);

-- ============================================================
-- Seed role_labels defaults
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM role_labels WHERE role_key = 'master')
    INSERT INTO role_labels (role_key, label) VALUES ('master', 'Iron Fist');
IF NOT EXISTS (SELECT 1 FROM role_labels WHERE role_key = 'admin')
    INSERT INTO role_labels (role_key, label) VALUES ('admin', 'Admin');
IF NOT EXISTS (SELECT 1 FROM role_labels WHERE role_key = 'user')
    INSERT INTO role_labels (role_key, label) VALUES ('user', 'Member');
