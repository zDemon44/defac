-- DEFAC - Esquema inicial para MySQL 8.0+
-- Ejecute este archivo completo desde MySQL Workbench.

CREATE DATABASE IF NOT EXISTS `defac-base`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `defac-base`;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tax_id VARCHAR(13) NOT NULL,
  business_name VARCHAR(300) NOT NULL,
  trade_name VARCHAR(300) NULL,
  email VARCHAR(320) NULL,
  phone VARCHAR(30) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_tax_id (tax_id),
  CONSTRAINT chk_companies_tax_id CHECK (tax_id REGEXP '^[0-9]{10,13}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  movement_type ENUM('PURCHASE', 'SALE') NOT NULL,
  fiscal_year SMALLINT UNSIGNED NOT NULL,
  fiscal_month TINYINT UNSIGNED NOT NULL,
  source_filename VARCHAR(500) NOT NULL,
  status ENUM('IMPORTED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'ERROR') NOT NULL DEFAULT 'IMPORTED',
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  downloaded_records INT UNSIGNED NOT NULL DEFAULT 0,
  manual_records INT UNSIGNED NOT NULL DEFAULT 0,
  error_records INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_batches_company_period (company_id, movement_type, fiscal_year, fiscal_month),
  CONSTRAINT fk_batches_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT chk_batches_month CHECK (fiscal_month BETWEEN 1 AND 12),
  CONSTRAINT chk_batches_year CHECK (fiscal_year BETWEEN 2000 AND 2200)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NULL,
  movement_type ENUM('PURCHASE', 'SALE') NOT NULL,
  document_type VARCHAR(30) NOT NULL DEFAULT 'FACTURA',
  document_version VARCHAR(20) NULL,
  access_key CHAR(49) NOT NULL,
  authorization_number VARCHAR(64) NULL,
  authorization_date DATETIME NULL,
  issue_date DATE NOT NULL,
  issuer_tax_id VARCHAR(13) NOT NULL,
  issuer_business_name VARCHAR(300) NOT NULL,
  recipient_id VARCHAR(20) NULL,
  recipient_business_name VARCHAR(300) NULL,
  establishment CHAR(3) NOT NULL,
  emission_point CHAR(3) NOT NULL,
  sequential CHAR(9) NOT NULL,
  document_number VARCHAR(25) NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  tip DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  vat_total DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  sri_status VARCHAR(40) NOT NULL DEFAULT 'AUTORIZADO',
  xml_source ENUM('SRI', 'MANUAL') NOT NULL,
  xml_path VARCHAR(1000) NOT NULL,
  xml_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_company_movement_key (company_id, movement_type, access_key),
  KEY idx_invoices_company_date (company_id, movement_type, issue_date),
  KEY idx_invoices_issuer (issuer_tax_id, issue_date),
  KEY idx_invoices_recipient (recipient_id, issue_date),
  KEY idx_invoices_document_number (document_number),
  CONSTRAINT fk_invoices_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_batch FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  CONSTRAINT chk_invoices_access_key CHECK (access_key REGEXP '^[0-9]{49}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_taxes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  tax_code VARCHAR(10) NOT NULL,
  percentage_code VARCHAR(10) NOT NULL,
  rate DECIMAL(9,4) NULL,
  taxable_base DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  tax_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_tax (invoice_id, tax_code, percentage_code, rate),
  KEY idx_invoice_taxes_invoice (invoice_id),
  CONSTRAINT fk_invoice_taxes_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_details (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  line_number INT UNSIGNED NOT NULL,
  main_code VARCHAR(100) NULL,
  auxiliary_code VARCHAR(100) NULL,
  description VARCHAR(1000) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
  unit_price DECIMAL(18,6) NOT NULL DEFAULT 0,
  discount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  total_without_tax DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_detail_line (invoice_id, line_number),
  KEY idx_invoice_details_invoice (invoice_id),
  CONSTRAINT fk_invoice_details_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_taxes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  detail_id BIGINT UNSIGNED NOT NULL,
  tax_code VARCHAR(10) NOT NULL,
  percentage_code VARCHAR(10) NOT NULL,
  rate DECIMAL(9,4) NULL,
  taxable_base DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  tax_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  KEY idx_detail_taxes_detail (detail_id),
  CONSTRAINT fk_detail_taxes_detail FOREIGN KEY (detail_id) REFERENCES invoice_details(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  payment_method_code VARCHAR(10) NOT NULL,
  amount DECIMAL(18,2) NULL,
  term_value DECIMAL(12,2) NULL,
  term_unit VARCHAR(30) NULL,
  PRIMARY KEY (id),
  KEY idx_invoice_payments_invoice (invoice_id),
  CONSTRAINT fk_invoice_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS batch_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  access_key CHAR(49) NOT NULL,
  document_number VARCHAR(25) NULL,
  issuer_business_name VARCHAR(300) NULL,
  status ENUM('PENDING', 'DOWNLOADED', 'EXISTING', 'MANUAL', 'OUTSIDE_RANGE', 'NOT_FOUND', 'NOT_AUTHORIZED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  message TEXT NULL,
  invoice_id BIGINT UNSIGNED NULL,
  processed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batch_items_key (batch_id, access_key),
  KEY idx_batch_items_status (batch_id, status),
  CONSTRAINT fk_batch_items_batch FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  CONSTRAINT chk_batch_items_access_key CHECK (access_key REGEXP '^[0-9]{49}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Esquema inicial: empresas, compras, ventas, facturas, detalles e impuestos')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Verificación final. Debe mostrar todas las tablas creadas.
SHOW TABLES FROM `defac-base`;
