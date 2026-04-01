import { initAuth } from "./auth";
import { initNavigation } from "./navigation";
import { initList } from "./list";
import { initExtractionEvents } from "./extraction";
import { initTranscriptionEvents } from "./transcription";
import { initGalleryEvents } from "./gallery";

initAuth();
initNavigation();
initList();
initExtractionEvents();
initTranscriptionEvents();
initGalleryEvents();

