import { type ConfigSchema } from '../src/config-schema';

export const mockConfig: ConfigSchema = {
  announcements: [],
  background: {
    image: '',
    color: '',
  },
  provider: {
    type: 'basic',
    loginUrl: '',
  },
  chooseLocation: {
    enabled: true,
    numberToShow: 3,
    useLoginLocationTag: true,
    locationsPerRequest: 50,
    locationTag: '',
    mflCodeAttributeTypeUuid: '3118cabe-9a5d-420c-8a55-86234deb9b1b',
  },
  logo: {
    src: null,
    alt: 'Logo',
  },
  links: {
    loginSuccess: '${openmrsSpaBase}/home',
  },
  footer: {
    additionalLogos: [],
  },
  showPasswordOnSeparateScreen: true,
  showPasswordReset: true,
  twoFactorAuth: {
    enabled: true,
    dashboardTitle: {
      key: 'twoFactorAuth',
      value: 'Two Factor Authentication',
    },
  },
};
