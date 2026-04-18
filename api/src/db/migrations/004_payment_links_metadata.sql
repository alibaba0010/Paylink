-- Add metadata fields to payment_links for rich UI
ALTER TABLE payment_links
ADD COLUMN icon_key     TEXT DEFAULT 'zap',
ADD COLUMN view_count   INTEGER DEFAULT 0,
ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
