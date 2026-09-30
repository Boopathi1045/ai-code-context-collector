export type RelationshipType =
  | 'IMPORTS'
  | 'EXPORTS'
  | 'CALLS'
  | 'REFERENCES'
  | 'ANGULAR_TEMPLATE'
  | 'ANGULAR_STYLE'
  | 'HTTP_API'
  | 'EXPRESS_ROUTE'
  | 'CONTROLLER'
  | 'SERVICE'
  | 'MODEL'
  | 'MIDDLEWARE';

export interface RelationshipEdge {
  fromPath: string;
  toPath: string;
  type: RelationshipType;
  description: string;
  symbol?: string;
  detail?: string;
}
