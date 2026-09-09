// Minimal in-memory data layer for the demo.
//
// The real engagement would back this with WorkOS + a database. For the
// proof-of-capability demo we only need something that models per-tenant
// isolation: every row carries an `organizationId`, and callers must scope
// their queries to the organization the signed-in user belongs to.

export type Member = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: "admin" | "team_lead" | "compliance";
};

// `organizationId` values are real WorkOS Organization IDs created in the dashboard.
const MEMBERS: Member[] = [
  // Tenant 1: Acme Corp
  { 
    id: "m_1", 
    organizationId: "org_01M22148NBHDQSB8DCE7TRNK56", 
    email: "kelsi.anderson26+acme@gmail.com", 
    name: "Ada Admin", 
    role: "admin" 
  },
  { 
    id: "m_2", 
    organizationId: "org_01M22148NBHDQSB8DCE7TRNK56", 
    email: "leo@acme.test", 
    name: "Leo Lead", 
    role: "team_lead" 
  },

  // Tenant 2: Strawberry Bikes
  { 
    id: "m_3", 
    organizationId: "org_01M2214SR7QTB858X2GX9Q9MET", 
    email: "kelsi.anderson26+strawberry@gmail.com", 
    name: "Sam Strawberry", 
    role: "admin" 
  },
];

type MemberQuery = {
  where: { organizationId: string };
};

export const db = {
  members: {
    async findMany({ where }: MemberQuery): Promise<Member[]> {
      return MEMBERS.filter((m) => m.organizationId === where.organizationId);
    },
  },
};
