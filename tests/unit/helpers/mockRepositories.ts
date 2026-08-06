type RepositoryMethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

export type RepositoryMock<T extends object> = {
  [K in RepositoryMethodKeys<T>]: T[K] extends (
    ...args: infer Args
  ) => infer Return
    ? jest.Mock<Return, Args>
    : never;
};

export function createRepositoryMock<T extends object>(
  methods: RepositoryMethodKeys<T>[]
): RepositoryMock<T> {
  const mock = {} as RepositoryMock<T>;

  for (const method of methods) {
    mock[method] = jest.fn() as RepositoryMock<T>[typeof method];
  }

  return mock;
}
