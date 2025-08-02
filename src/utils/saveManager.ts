import logger from '@/utils/logger';

/**
 * 룸 ID에서 repositoryId와 filePath 추출
 */
interface ParsedRoomId {
  repositoryId: number;
  filePath: string;
}

const parseRoomId = (roomId: string): ParsedRoomId | null => {
  // 룸 ID 패턴: "repo-{repositoryId}-{filePath}"
  const match = roomId.match(/^repo-(\d+)-(.+)$/);

  if (!match) {
    return null;
  }

  const repositoryId = parseInt(match[1], 10);
  const filePath = match[2];

  if (isNaN(repositoryId) || !filePath) {
    return null;
  }

  return { repositoryId, filePath };
};

/**
 * 저장 API 호출을 담당하는 클래스
 */
export class SaveManager {
  private apiBaseUrl: string;

  constructor() {
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
  }

  /**
   * 메인 앱 API를 호출하여 파일 저장
   */
  async triggerSaveAPI(roomId: string, content: string): Promise<void> {
    try {
      const parsedRoom = parseRoomId(roomId);

      if (!parsedRoom) {
        logger.warn(`저장 API 호출 실패: 잘못된 룸 ID 형식 - ${roomId}`);
        return;
      }

      const { repositoryId, filePath } = parsedRoom;

      logger.info(`저장 API 호출 시작`, {
        roomId,
        repositoryId,
        filePath,
        contentLength: content.length,
      });

      // 파일 ID는 경로에서 추출하거나 별도 로직으로 처리
      // 여기서는 filePath를 그대로 사용 (실제 구현에서는 fileId 매핑 필요)
      const apiUrl = `${this.apiBaseUrl}/repositories/${repositoryId}/files/content`;

      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filePath,
          content,
          source: 'yjs-collaboration',
        }),
      });

      if (!response.ok) {
        throw new Error(`API 호출 실패: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      logger.info(`저장 API 호출 성공`, {
        roomId,
        repositoryId,
        filePath,
        result,
      });
    } catch (error) {
      logger.error(`저장 API 호출 실패: ${roomId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * 코드 에디터 룸인지 확인 - 기존 함수 유지
   */
  static isCodeEditorRoom(roomId: string): boolean {
    // "repo-{숫자}-{파일경로}" 패턴만 허용
    const pattern = /^repo-\d+-[^\/]+/;
    return pattern.test(roomId);
  }

  // 🔧 추가: 파일 트리 룸인지 확인
  static isFileTreeRoom(roomId: string): boolean {
    // "filetree-{숫자}" 패턴 확인
    const pattern = /^filetree-\d+$/;
    return pattern.test(roomId);
  }

  // 🔧 추가: 지원되는 룸인지 확인
  static isSupportedRoom(roomId: string): boolean {
    return SaveManager.isCodeEditorRoom(roomId) || SaveManager.isFileTreeRoom(roomId);
  }

  // 🔧 추가: 파일 트리 룸에서 repositoryId 추출
  static parseFileTreeRoomId(roomId: string): number | null {
    const match = roomId.match(/^filetree-(\d+)$/);
    if (!match) return null;

    const repositoryId = parseInt(match[1], 10);
    return isNaN(repositoryId) ? null : repositoryId;
  }
}
