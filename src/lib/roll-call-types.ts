export type RollCallVisit = {
  id: string;
  name: string;
  type: "GUEST" | "DELIVERY";
  destination: string;
  department: string | null;
  checkInTime: string;
  exitTime: string | null;
};

export type RollCallSnapshot = {
  onSite: RollCallVisit[];
  expectedBack: RollCallVisit[];
  updatedAt: string;
};
