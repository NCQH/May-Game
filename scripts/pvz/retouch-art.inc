    // The video HD mod retouches at the original pixel dimensions. Load such
    // pixels before atlas construction, keeping all GOTY resource dimensions.
    std::string mayRetouchPath = theFileName;
    std::replace(mayRetouchPath.begin(), mayRetouchPath.end(), '\\', '/');
    std::transform(mayRetouchPath.begin(), mayRetouchPath.end(), mayRetouchPath.begin(), [](unsigned char c) { return c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c; });
    while (!mayRetouchPath.empty() && mayRetouchPath.front() == '/') mayRetouchPath.erase(mayRetouchPath.begin());
    const auto mayDot = mayRetouchPath.rfind('.');
    const auto maySlash = mayRetouchPath.rfind('/');
    if (mayDot != std::string::npos && (maySlash == std::string::npos || mayDot > maySlash)) mayRetouchPath.erase(mayDot);
    mayRetouchPath = "/hd/" + mayRetouchPath + ".png";
    if (aLoadedImage && std::filesystem::exists(mayRetouchPath))
    {
        std::unique_ptr<ImageLib::Image> replacement(ImageLib::GetImage(mayRetouchPath, true));
        if (replacement && replacement->GetWidth() == aLoadedImage->GetWidth() && replacement->GetHeight() == aLoadedImage->GetHeight())
            aLoadedImage = std::move(replacement);
    }
