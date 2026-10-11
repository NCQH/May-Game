/* Máy Game additions, 2026. SPDX-License-Identifier: LGPL-3.0-or-later
 * Keep image/cel dimensions in the original logical coordinate system.
 * Only GPU texture storage and texel padding use the HD pixel dimensions.
 */
static std::unique_ptr<ImageLib::Image> MayLoadHd(MemoryImage* image)
{
    if (image->mFilePath.empty()) return nullptr; // Generated or software-modified image.
    std::string file = image->mFilePath;
    std::replace(file.begin(), file.end(), '\\', '/');
    std::transform(file.begin(), file.end(), file.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    while (!file.empty() && file.front() == '/') file.erase(file.begin());
    auto dot = file.rfind('.');
    auto slash = file.rfind('/');
    if (dot != std::string::npos && (slash == std::string::npos || dot > slash)) file.erase(dot);
    file = "/hd/" + file + ".png";
    if (!std::filesystem::exists(file)) return nullptr;
    std::unique_ptr<ImageLib::Image> hd(ImageLib::GetImage(file, true));
    if (!hd || image->mWidth <= 0 || image->mHeight <= 0) return nullptr;
    const int scale = hd->mWidth / image->mWidth;
    if ((scale != 2 && scale != 4) || hd->mWidth != image->mWidth * scale || hd->mHeight != image->mHeight * scale)
        return nullptr;
    return hd;
}

// Bicubic sampling of the same source pixels. No redesigned art or invented detail.
// Interpolate premultiplied alpha to avoid dark halos around transparent sprites.
static float MayCubic(float distance)
{
    const float x = std::abs(distance);
    if (x < 1.0f) return 1.5f * x * x * x - 2.5f * x * x + 1.0f;
    if (x < 2.0f) return -0.5f * x * x * x + 2.5f * x * x - 4.0f * x + 2.0f;
    return 0.0f;
}

static std::unique_ptr<ImageLib::Image> MayUpscaleOriginal(MemoryImage* image)
{
    if (image->mFilePath.empty() || image->mWidth <= 0 || image->mHeight <= 0 ||
        image->mWidth * 2 > MAX_TEXTURE_SIZE || image->mHeight * 2 > MAX_TEXTURE_SIZE) return nullptr;
    auto result = std::make_unique<ImageLib::Image>();
    result->mWidth = image->mWidth * 2;
    result->mHeight = image->mHeight * 2;
    result->mBits = std::make_unique<uint32_t[]>(static_cast<size_t>(result->mWidth) * result->mHeight);
    const auto* bits = image->GetBits();
    const int cellW = std::max(1, image->mWidth / std::max(1, image->mNumCols));
    const int cellH = std::max(1, image->mHeight / std::max(1, image->mNumRows));
    for (int y = 0; y < result->mHeight; ++y)
    {
        const float sy = (y + 0.5f) / 2.0f - 0.5f;
        const int baseY = static_cast<int>(std::floor(sy));
        const int minY = (y / 2 / cellH) * cellH;
        const int maxY = std::min(minY + cellH - 1, image->mHeight - 1);
        for (int x = 0; x < result->mWidth; ++x)
        {
            const float sx = (x + 0.5f) / 2.0f - 0.5f;
            const int baseX = static_cast<int>(std::floor(sx));
            const int minX = (x / 2 / cellW) * cellW;
            const int maxX = std::min(minX + cellW - 1, image->mWidth - 1);
            float alpha = 0, red = 0, green = 0, blue = 0;
            for (int j = -1; j <= 2; ++j)
            {
                const int py = std::clamp(baseY + j, minY, maxY);
                const float wy = MayCubic(sy - (baseY + j));
                for (int i = -1; i <= 2; ++i)
                {
                    const int px = std::clamp(baseX + i, minX, maxX);
                    const float weight = wy * MayCubic(sx - (baseX + i));
                    const uint32_t pixel = bits[static_cast<size_t>(py) * image->mWidth + px];
                    const float a = static_cast<float>(pixel >> 24);
                    alpha += weight * a;
                    red += weight * a * ((pixel >> 16) & 255);
                    green += weight * a * ((pixel >> 8) & 255);
                    blue += weight * a * (pixel & 255);
                }
            }
            auto channel = [](float value) { return static_cast<uint32_t>(std::clamp(std::lround(value), 0L, 255L)); };
            uint32_t pixel = 0;
            if (alpha > 0.01f)
                pixel = (channel(alpha) << 24) | (channel(red / alpha) << 16) | (channel(green / alpha) << 8) | channel(blue / alpha);
            result->mBits[static_cast<size_t>(y) * result->mWidth + x] = pixel;
        }
    }
    return result;
}

static void MayUploadHd(ImageLib::Image* image, int scale, int offx, int offy, int texW, int texH, bool create, bool repeat)
{
    const int width = texW * scale;
    const int height = texH * scale;
    std::vector<uint32_t> pixels(static_cast<size_t>(width) * height);
    for (int y = 0; y < height; ++y)
    {
        const int sourceY = std::min(offy * scale + y, image->mHeight - 1);
        for (int x = 0; x < width; ++x)
        {
            const int sourceX = std::min(offx * scale + x, image->mWidth - 1);
            pixels[static_cast<size_t>(y) * width + x] = ArgbToRgba(image->mBits[static_cast<size_t>(sourceY) * image->mWidth + sourceX]);
        }
    }
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
    if (create)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
    else
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
}
