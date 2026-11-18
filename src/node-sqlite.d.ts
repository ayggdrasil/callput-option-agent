// Lazy-loaded only for the optional single-host filesystem backend (Node 22+).
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...values: any[]): any;
      get(...values: any[]): any;
      all(...values: any[]): any[];
    };
    close(): void;
  }
}
