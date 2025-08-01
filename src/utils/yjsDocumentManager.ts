import * as Y from 'yjs';
import logger from '@/utils/logger';

/**
 * Yjs 문서 내용 추출 및 관리를 담당하는 클래스
 */
export class YjsDocumentManager {
  private documents: Map<string, Y.Doc> = new Map();
  private documentStates: Map<string, Uint8Array> = new Map();

  /**
   * Yjs 문서에서 텍스트 내용 추출
   */
  getDocumentContent(roomId: string): string {
    try {
      const doc = this.documents.get(roomId);
      if (!doc) {
        logger.debug(`문서를 찾을 수 없음: ${roomId}`);
        return '';
      }

      const yText = doc.getText('monaco-content');
      const content = yText.toString();

      logger.debug(`문서 내용 추출`, {
        roomId,
        contentLength: content.length,
        contentPreview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      });

      return content;
    } catch (error) {
      logger.error(`문서 내용 추출 실패: ${roomId}`, error);
      return '';
    }
  }

  /**
   * WebSocket 메시지에서 Yjs 문서 상태 추출/업데이트
   */
  handleYjsMessage(roomId: string, message: Buffer): void {
    try {
      // Yjs 메시지인지 확인 (첫 바이트가 0이면 sync 메시지)
      if (message.length === 0) return;

      // 문서가 없으면 새로 생성
      if (!this.documents.has(roomId)) {
        const doc = new Y.Doc();
        this.documents.set(roomId, doc);
        logger.debug(`새 Yjs 문서 생성: ${roomId}`);
      }

      const doc = this.documents.get(roomId)!;

      // Yjs update 메시지 적용
      try {
        Y.applyUpdate(doc, new Uint8Array(message));

        // 문서 상태 저장 (최신 상태 유지)
        const state = Y.encodeStateAsUpdate(doc);
        this.documentStates.set(roomId, state);

        logger.debug(`Yjs 메시지 처리 완료`, {
          roomId,
          messageSize: message.length,
          documentSize: state.length,
        });
      } catch (updateError) {
        // Yjs 메시지가 아닌 경우 무시 (awareness 메시지 등)
        logger.debug(`Yjs 업데이트 적용 실패 (일반적으로 awareness 메시지): ${roomId}`);
      }
    } catch (error) {
      logger.error(`Yjs 메시지 처리 실패: ${roomId}`, error);
    }
  }

  /**
   * 문서 상태 정보 조회
   */
  getDocumentInfo(roomId: string): { exists: boolean; contentLength: number; stateSize: number } {
    const doc = this.documents.get(roomId);
    const state = this.documentStates.get(roomId);

    if (!doc) {
      return { exists: false, contentLength: 0, stateSize: 0 };
    }

    const content = this.getDocumentContent(roomId);

    return {
      exists: true,
      contentLength: content.length,
      stateSize: state?.length || 0,
    };
  }

  /**
   * 특정 문서 정리
   */
  cleanupDocument(roomId: string): void {
    try {
      const doc = this.documents.get(roomId);
      if (doc) {
        doc.destroy();
        this.documents.delete(roomId);
        logger.debug(`Yjs 문서 정리: ${roomId}`);
      }

      this.documentStates.delete(roomId);
      logger.debug(`문서 상태 정리: ${roomId}`);
    } catch (error) {
      logger.error(`문서 정리 실패: ${roomId}`, error);
    }
  }

  /**
   * 모든 문서 정리 (서버 종료 시)
   */
  cleanupAllDocuments(): void {
    logger.info(`모든 Yjs 문서 정리 시작 (총 ${this.documents.size}개)`);

    this.documents.forEach((doc, roomId) => {
      try {
        doc.destroy();
        logger.debug(`문서 정리: ${roomId}`);
      } catch (error) {
        logger.error(`문서 정리 실패: ${roomId}`, error);
      }
    });

    this.documents.clear();
    this.documentStates.clear();

    logger.info('모든 Yjs 문서 정리 완료');
  }

  /**
   * 현재 관리 중인 문서 목록 조회
   */
  getDocumentList(): Array<{ roomId: string; contentLength: number; stateSize: number }> {
    return Array.from(this.documents.keys()).map(roomId => ({
      roomId,
      ...this.getDocumentInfo(roomId),
    }));
  }
}
