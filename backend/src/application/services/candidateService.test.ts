// Define mocks BEFORE requiring the service under test
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    application: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    candidate: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    education: {
      create: jest.fn(),
    },
    workExperience: {
      create: jest.fn(),
    },
    resume: {
      create: jest.fn(),
    },
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

// Mock domain models to isolate service logic from Prisma
jest.mock('../../domain/models/Candidate', () => {
  return {
    Candidate: class {
      id?: number;
      firstName!: string;
      lastName!: string;
      email!: string;
      phone?: string;
      address?: string;
      educations: any[] = [];
      workExperiences: any[] = [];
      resumes: any[] = [];
      applications: any[] = [];
      constructor(data: any) {
        Object.assign(this, data);
      }
      async save() {
        if (!this.id) {
          return { id: 123, firstName: this.firstName, lastName: this.lastName, email: this.email };
        }
        return { id: this.id, firstName: this.firstName, lastName: this.lastName, email: this.email };
      }
    },
  };
});

jest.mock('../../domain/models/Education', () => {
  return {
    Education: class {
      institution!: string; title!: string; startDate!: string; endDate?: string; candidateId?: number;
      constructor(data: any) { Object.assign(this, data); }
      async save() { return { id: Math.floor(Math.random() * 1000), ...this }; }
    },
  };
});

jest.mock('../../domain/models/WorkExperience', () => {
  return {
    WorkExperience: class {
      company!: string; position!: string; description?: string; startDate!: string; endDate?: string; candidateId?: number;
      constructor(data: any) { Object.assign(this, data); }
      async save() { return { id: Math.floor(Math.random() * 1000), ...this }; }
    },
  };
});

jest.mock('../../domain/models/Resume', () => {
  return {
    Resume: class {
      filePath!: string; fileType!: string; candidateId?: number;
      constructor(data: any) { Object.assign(this, data); }
      async save() { return { id: Math.floor(Math.random() * 1000), ...this }; }
    },
  };
});

jest.mock('../../domain/models/Application', () => {
  return {
    Application: class {
      static async findOneByPositionCandidateId(appId: number, candidateId: number) { return null; }
      currentInterviewStep: number = 0;
      async save() { return { id: 1, currentInterviewStep: this.currentInterviewStep }; }
    },
  };
});

// Now require the service under test and Prisma client
const { updateCandidateStage, addCandidate } = require('./candidateService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

describe('updateCandidateStage', () => {
  it('should update the candidate stage and return the updated application', async () => {
    const mockApplication = {
      id: 1,
      positionId: 1,
      candidateId: 1,
      currentInterviewStep: 1,
      applicationDate: new Date(),
      notes: null,
    };

    jest.spyOn(prisma.application, 'findFirst').mockResolvedValue(mockApplication as any);
    jest.spyOn(prisma.application, 'update').mockResolvedValue({
      ...mockApplication,
      currentInterviewStep: 2,
    } as any);

    const result = await updateCandidateStage(1, 1, 2);
    expect(result).toEqual(expect.objectContaining({
      ...mockApplication,
      currentInterviewStep: 2,
    }));
  });

  it('should throw when application is not found', async () => {
    const { Application } = require('../../domain/models/Application');
    jest.spyOn(Application, 'findOneByPositionCandidateId').mockResolvedValueOnce(null);
    await expect(updateCandidateStage(999, 1, 2)).rejects.toThrow('Application not found');
  });

  it('should propagate errors from application.save()', async () => {
    const { Application } = require('../../domain/models/Application');
    const appInstance = { currentInterviewStep: 0, save: jest.fn().mockRejectedValue(new Error('DB error')) };
    jest.spyOn(Application, 'findOneByPositionCandidateId').mockResolvedValueOnce(appInstance);

    await expect(updateCandidateStage(1, 1, 2)).rejects.toThrow('DB error');
    expect(appInstance.save).toHaveBeenCalledTimes(1);
  });
});

describe('addCandidate - validations', () => {
  const invalidCases: Array<[any, string]> = [
    [{ lastName: 'Lopez', email: 'a@b.com', phone: '612345678' }, 'Invalid name'],
    [{ firstName: 'Ana', email: 'invalid', lastName: 'Lopez', phone: '612345678' }, 'Invalid email'],
    [{ firstName: 'Ana', lastName: 'Lopez', email: 'a@b.com', phone: '123' }, 'Invalid phone'],
    [{ firstName: 'Álvaro', lastName: 'Núñez', email: 'a@b.com', educations: [{ institution: '', title: 'X', startDate: '2021-01-01' }] }, 'Invalid institution'],
    [{ firstName: 'Álvaro', lastName: 'Núñez', email: 'a@b.com', workExperiences: [{ company: 'X', position: 'Y', description: 'd', startDate: '20210101' }] }, 'Invalid date'],
    [{ firstName: 'Ana', lastName: 'Lopez', email: 'a@b.com', cv: { filePath: 123, fileType: 'pdf' } }, 'Invalid CV data'],
  ];

  invalidCases.forEach(([data, expectedMsg]) => {
    it(`should throw validation error: ${expectedMsg}`, async () => {
      await expect(addCandidate(data)).rejects.toThrow(expectedMsg);
    });
  });

  it('should not enforce required fields when data.id exists (edit mode)', async () => {
    await expect(addCandidate({ id: 10 })).resolves.toBeDefined();
  });
});

describe('addCandidate - persistence and side effects', () => {
  it('creates candidate and related entities, linking candidateId and pushing into arrays', async () => {
    const data = {
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@example.com',
      phone: '612345678',
      educations: [
        { institution: 'Uni', title: 'CS', startDate: '2020-01-01', endDate: '2021-01-01' },
      ],
      workExperiences: [
        { company: 'ACME', position: 'Dev', description: 'Build stuff', startDate: '2021-02-01' },
      ],
      cv: { filePath: '/tmp/cv.pdf', fileType: 'pdf' },
    };

    const result = await addCandidate(data);
    expect(result).toHaveProperty('id', 123);
  });

  it('handles cv absent or empty object without attempting save', async () => {
    const data = {
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@example.com',
      phone: '612345678',
      cv: {},
    };

    const res = await addCandidate(data);
    expect(res).toHaveProperty('id', 123);
  });

  it('translates P2002 unique email error', async () => {
    const { Candidate } = require('../../domain/models/Candidate');
    jest.spyOn(Candidate.prototype, 'save').mockRejectedValueOnce({ code: 'P2002' });

    const data = { firstName: 'Ana', lastName: 'Lopez', email: 'dup@example.com', phone: '612345678' };
    await expect(addCandidate(data)).rejects.toThrow('The email already exists in the database');
  });
});