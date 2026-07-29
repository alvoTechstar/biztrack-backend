export const tenantMiddleware = (req, res, next) => {
    //Extract busineessId from headers (or req.user after authentication)
    const businessId = req.headers['x-business-id'];

    if(!businessId){
        return res.status(403).json({ error: 'Unauthorized: Business Context missing.' });
    }

    // Attach to the request object so services can access it
    re.businessId = businessId;
    next();
};