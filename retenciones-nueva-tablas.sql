-- DEFAC v3 - Retenciones recibidas por ventas (MySQL 8.0+)
-- Ejecutar completo desde MySQL Workbench.
USE `defac-base`;

CREATE TABLE IF NOT EXISTS withholdings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  access_key CHAR(49) NOT NULL,
  authorization_number VARCHAR(64) NOT NULL,
  authorization_date DATETIME NULL,
  issue_date DATE NOT NULL,
  document_version VARCHAR(20) NULL,
  issuer_tax_id VARCHAR(13) NOT NULL,
  issuer_business_name VARCHAR(300) NOT NULL,
  retained_subject_id VARCHAR(20) NOT NULL,
  retained_subject_name VARCHAR(300) NOT NULL,
  establishment CHAR(3) NOT NULL,
  emission_point CHAR(3) NOT NULL,
  sequential CHAR(9) NOT NULL,
  document_number VARCHAR(25) NOT NULL,
  income_tax_withheld DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  vat_withheld DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  total_withheld DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  xml_path VARCHAR(1000) NOT NULL,
  xml_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_withholdings_company_access (company_id, access_key),
  KEY idx_withholdings_company_date (company_id, issue_date),
  KEY idx_withholdings_issuer (issuer_tax_id, issue_date),
  CONSTRAINT fk_withholdings_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT chk_withholdings_access_key CHECK (access_key REGEXP '^[0-9]{49}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS withholding_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  withholding_id BIGINT UNSIGNED NOT NULL,
  invoice_id BIGINT UNSIGNED NULL,
  support_document_code VARCHAR(10) NOT NULL,
  support_document_number VARCHAR(25) NOT NULL,
  support_authorization_number VARCHAR(64) NULL,
  support_issue_date DATE NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_withholding_support (withholding_id, support_document_code, support_document_number),
  KEY idx_withholding_documents_number (support_document_number),
  CONSTRAINT fk_withholding_documents_header FOREIGN KEY (withholding_id) REFERENCES withholdings(id) ON DELETE CASCADE,
  CONSTRAINT fk_withholding_documents_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS withholding_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  withholding_document_id BIGINT UNSIGNED NOT NULL,
  tax_type ENUM('INCOME_TAX', 'VAT') NOT NULL,
  tax_code VARCHAR(10) NOT NULL,
  withholding_code VARCHAR(20) NOT NULL,
  taxable_base DECIMAL(18,4) NOT NULL DEFAULT 0,
  withholding_percentage DECIMAL(9,4) NOT NULL DEFAULT 0,
  withheld_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_withholding_lines_document (withholding_document_id),
  KEY idx_withholding_lines_type (tax_type),
  CONSTRAINT fk_withholding_lines_document FOREIGN KEY (withholding_document_id) REFERENCES withholding_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO schema_migrations (version, description)
VALUES ('003', 'Retenciones de renta e IVA vinculadas a facturas de venta')
ON DUPLICATE KEY UPDATE description = VALUES(description);

SHOW TABLES LIKE 'withholding%';
