export interface Company {
  id: number;
  taxId: string;
  businessName: string;
  tradeName?: string;
  email?: string;
  phone?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyInput {
  taxId: string;
  businessName: string;
  tradeName?: string;
  email?: string;
  phone?: string;
}
