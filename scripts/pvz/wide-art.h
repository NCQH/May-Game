/* Máy Game additions, 2026. SPDX-License-Identifier: LGPL-3.0-or-later */
#pragma once
#include "SexyAppBase.h"
#include "graphics/Graphics.h"
#include "graphics/GLImage.h"
#include <filesystem>
#include <unordered_map>
#include <algorithm>
#include <cctype>
#include <string_view>

// Widescreen scenery is separate from HD sprite textures. Never change the
// original resource dimensions: gameplay, animation attachments and hit boxes
// continue to use the GOTY resource and its original coordinates.
inline Sexy::Image* MayWideArt(Sexy::SexyAppBase* app, std::string file)
{
    std::replace(file.begin(), file.end(), '\\', '/');
    std::transform(file.begin(), file.end(), file.begin(), [](unsigned char c) { return std::tolower(c); });
    while (!file.empty() && file.front() == '/') file.erase(file.begin());
    const auto dot = file.rfind('.');
    if (dot != std::string::npos) file.erase(dot);
    file = "/wide/" + file + ".png";
    // These images live for the web engine session. Do not destroy textures
    // after the app's GL interface has already been torn down on exit.
    static std::unordered_map<std::string, Sexy::Image*> images;
    const auto found = images.find(file);
    if (found != images.end()) return found->second;
    Sexy::Image* image = nullptr;
    if (std::filesystem::exists(file)) image = app->GetImage(file, true);
    images.emplace(file, image);
    return image;
}

inline void MayDrawWideBackdrop(Sexy::Graphics* g, Sexy::SexyAppBase* app, Sexy::Image* original, float x = 0)
{
    auto memory = dynamic_cast<Sexy::MemoryImage*>(original);
    Sexy::Image* wide = memory ? MayWideArt(app, memory->mFilePath) : nullptr;
    if (wide && wide->GetHeight() == original->GetHeight() && wide->GetWidth() == original->GetWidth() + 266)
        g->DrawImageF(wide, x - 133.0f, 0);
    else g->DrawImageF(original, x, 0);
}

inline int MayClampCameraX(Sexy::SexyAppBase* app, int x)
{
    return MayWideArt(app, "images/background1") ? std::clamp(x, -379, 219) : std::clamp(x, -246, 86);
}
