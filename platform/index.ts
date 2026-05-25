import { Platform } from 'obsidian';
import { PlatformService } from './PlatformService';
import { DesktopPlatform } from './DesktopPlatform';
import { MobilePlatform } from './MobilePlatform';

let activePlatformService: PlatformService | null = null;

export function getPlatform(): PlatformService {
  if (!activePlatformService) {
    if (Platform.isMobile) {
      activePlatformService = new MobilePlatform();
    } else {
      activePlatformService = new DesktopPlatform();
    }
  }
  return activePlatformService;
}

export * from './PlatformService';
