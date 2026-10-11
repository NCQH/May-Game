/* Máy Game additions, 2026. SPDX-License-Identifier: LGPL-3.0-or-later */
#include <SDL.h>
#include <emscripten.h>
#include <algorithm>
#include "SexyAppBase.h"
#include "graphics/GLInterface.h"
#include "widget/WidgetManager.h"
#include "misc/KeyCodes.h"

extern "C" {
EMSCRIPTEN_KEEPALIVE void may_resize(int width, int height)
{
    auto* app = Sexy::gSexyAppBase;
    if (!app || !app->mWindow || !app->mGLInterface) return;
    width = std::clamp(width, 800, 3840);
    height = std::clamp(height, 600, 2160);
    SDL_SetWindowSize(static_cast<SDL_Window*>(app->mWindow), width, height);
    app->mGLInterface->UpdateViewport();
    app->mWidgetManager->Resize(app->mScreenBounds, app->mGLInterface->mPresentationRect);
    app->mWidgetManager->MarkAllDirty();
}

EMSCRIPTEN_KEEPALIVE void may_menu()
{
    auto* app = Sexy::gSexyAppBase;
    if (!app || !app->mWidgetManager) return;
    app->mWidgetManager->KeyDown(Sexy::KEYCODE_ESCAPE);
    app->mWidgetManager->KeyUp(Sexy::KEYCODE_ESCAPE);
}
}
